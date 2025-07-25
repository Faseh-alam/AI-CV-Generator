const { getDB } = require('../config/database');
const logger = require('../utils/logger');
const { validateOptimization } = require('../utils/validation');
const WorkerPool = require('../services/workerPool');
const CacheService = require('../services/cacheService');
const Bull = require('bull');
const path = require('path');

// Initialize services
const cacheService = new CacheService();
const optimizationQueue = new Bull('optimization processing', {
  redis: process.env.REDIS_URL || 'redis://localhost:6379'
});

// Initialize worker pool
const workerPool = new WorkerPool(
  path.join(__dirname, '../utils/workers/optimizationWorker.js'),
  {
    poolSize: parseInt(process.env.WORKER_THREADS) || 4,
    maxQueueSize: 1000,
    workerTimeout: 300000 // 5 minutes
  }
);

// @desc    Create optimization
// @route   POST /api/v1/optimizations
// @access  Private
const createOptimization = async (req, res) => {
  try {
    const { error } = await validateOptimization(req.body, { 
      ip: req.ip, 
      userId: req.user.id 
    });
    
    if (error) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: error.details?.[0]?.message || error.message
        }
      });
    }

    const { resumeId, jobDescriptionId, optimizationLevel = 'balanced' } = req.body;
    const userId = req.user.id;
    const db = getDB();

    // Check cache for existing optimization
    const cacheKey = cacheService.generateKey('optimization', userId, resumeId, jobDescriptionId, optimizationLevel);
    const cachedResult = await cacheService.get(cacheKey);
    
    if (cachedResult) {
      logger.info('Optimization cache hit', { userId, resumeId, jobDescriptionId });
      return res.status(200).json({
        success: true,
        data: {
          ...cachedResult,
          fromCache: true
        }
      });
    }

    // Check if resume exists and belongs to user
    const resumeResult = await db.query(
      'SELECT id, parsed_data FROM resumes WHERE id = $1 AND user_id = $2 AND status = $3',
      [resumeId, userId, 'active']
    );

    if (resumeResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'RESUME_NOT_FOUND',
          message: 'Resume not found'
        }
      });
    }

    // Check if job description exists and belongs to user
    const jobResult = await db.query(
      'SELECT id, parsed_keywords FROM job_descriptions WHERE id = $1 AND user_id = $2',
      [jobDescriptionId, userId]
    );

    if (jobResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'JOB_NOT_FOUND',
          message: 'Job description not found'
        }
      });
    }

    const resumeData = resumeResult.rows[0].parsed_data;
    const jobKeywords = jobResult.rows[0].parsed_keywords;

    // Calculate original match score using worker
    const originalMatchScore = await workerPool.runTask('MATCH_SCORE', {
      resumeData,
      jobKeywords
    });

    // Create optimization record
    const optimizationResult = await db.query(
      `INSERT INTO optimizations (user_id, resume_id, job_description_id, original_match_score, status) 
       VALUES ($1, $2, $3, $4, $5) 
       RETURNING id, created_at`,
      [userId, resumeId, jobDescriptionId, originalMatchScore.overallScore, 'queued']
    );

    const optimization = optimizationResult.rows[0];

    // Add to Bull queue for processing
    const job = await optimizationQueue.add('process-optimization', {
      optimizationId: optimization.id,
      resumeData,
      jobKeywords,
      optimizationLevel,
      userId
    }, {
      priority: optimizationLevel === 'aggressive' ? 10 : 5,
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 2000
      }
    });

    // Track usage
    await db.query(
      'INSERT INTO usage_tracking (user_id, action, resource_id) VALUES ($1, $2, $3)',
      [userId, 'optimization', optimization.id]
    );

    logger.info(`Optimization queued by user ${userId}: ${optimization.id}`);

    res.status(201).json({
      success: true,
      data: {
        optimizationId: optimization.id,
        jobId: job.id,
        status: 'queued',
        originalMatchScore: originalMatchScore.overallScore,
        estimatedTime: 45, // seconds
        createdAt: optimization.created_at
      }
    });
  } catch (error) {
    logger.error('Create optimization error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'OPTIMIZATION_ERROR',
        message: 'Error creating optimization'
      }
    });
  }
};

// Set up Bull queue processor
optimizationQueue.process('process-optimization', async (job) => {
  const { optimizationId, resumeData, jobKeywords, optimizationLevel, userId } = job.data;
  const db = getDB();
  const startTime = Date.now();

  try {
    // Update status to processing
    await db.query(
      'UPDATE optimizations SET status = $1 WHERE id = $2',
      ['processing', optimizationId]
    );

    // Process optimization using worker pool
    const result = await workerPool.runTask('OPTIMIZE', {
      optimizationId,
      resumeData,
      jobKeywords,
      optimizationLevel,
      userId
    }, {
      timeout: 300000, // 5 minutes
      onProgress: (progress) => {
        job.progress(progress.progress);
      }
    });

    const processingTime = Date.now() - startTime;

    // Update optimization record
    await db.query(
      `UPDATE optimizations 
       SET optimized_content = $1, 
           optimized_match_score = $2, 
           changes_made = $3, 
           processing_time_ms = $4, 
           status = $5, 
           completed_at = CURRENT_TIMESTAMP
       WHERE id = $6`,
      [
        JSON.stringify(result.optimizedContent),
        result.optimizedMatchScore,
        JSON.stringify(result.changes),
        processingTime,
        'completed',
        optimizationId
      ]
    );

    // Cache the result
    const cacheKey = cacheService.generateKey('optimization', userId, optimizationId);
    await cacheService.set(cacheKey, {
      optimizationId,
      status: 'completed',
      optimizedContent: result.optimizedContent,
      optimizedMatchScore: result.optimizedMatchScore,
      changes: result.changes,
      processingTime
    }, {
      ttl: cacheService.ttlStrategies.optimizationResult
    });

    logger.info(`Optimization completed for user ${userId}: ${optimizationId}`);
    return result;

  } catch (error) {
    logger.error(`Optimization failed for ${optimizationId}:`, error);

    // Update optimization record with error
    await db.query(
      'UPDATE optimizations SET status = $1, optimization_notes = $2 WHERE id = $3',
      ['failed', error.message, optimizationId]
    );

    throw error;
  }
});

// @desc    Get all user optimizations
// @route   GET /api/v1/optimizations
// @access  Private
const getOptimizations = async (req, res) => {
  try {
    const userId = req.user.id;
    const db = getDB();

    // Check cache first
    const cacheKey = cacheService.generateKey('userOptimizations', userId);
    const cachedOptimizations = await cacheService.get(cacheKey);
    
    if (cachedOptimizations) {
      return res.status(200).json({
        success: true,
        count: cachedOptimizations.length,
        data: cachedOptimizations,
        fromCache: true
      });
    }

    const result = await db.query(
      `SELECT o.id, o.original_match_score, o.optimized_match_score, o.status, 
              o.created_at, o.completed_at, o.processing_time_ms,
              r.name as resume_name,
              j.title as job_title, j.company
       FROM optimizations o
       JOIN resumes r ON o.resume_id = r.id
       JOIN job_descriptions j ON o.job_description_id = j.id
       WHERE o.user_id = $1 
       ORDER BY o.created_at DESC`,
      [userId]
    );

    // Cache the results
    await cacheService.set(cacheKey, result.rows, {
      ttl: cacheService.ttlStrategies.userStats
    });

    res.status(200).json({
      success: true,
      count: result.rows.length,
      data: result.rows
    });
  } catch (error) {
    logger.error('Get optimizations error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'GET_OPTIMIZATIONS_ERROR',
        message: 'Error retrieving optimizations'
      }
    });
  }
};

// @desc    Get single optimization
// @route   GET /api/v1/optimizations/:id
// @access  Private
const getOptimization = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const db = getDB();

    const result = await db.query(
      `SELECT o.*, r.name as resume_name, j.title as job_title, j.company
       FROM optimizations o
       JOIN resumes r ON o.resume_id = r.id
       JOIN job_descriptions j ON o.job_description_id = j.id
       WHERE o.id = $1 AND o.user_id = $2`,
      [id, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'OPTIMIZATION_NOT_FOUND',
          message: 'Optimization not found'
        }
      });
    }

    const optimization = result.rows[0];

    res.status(200).json({
      success: true,
      data: {
        id: optimization.id,
        resumeName: optimization.resume_name,
        jobTitle: optimization.job_title,
        company: optimization.company,
        originalMatchScore: optimization.original_match_score,
        optimizedMatchScore: optimization.optimized_match_score,
        optimizedContent: optimization.optimized_content,
        changes: optimization.changes_made,
        processingTime: optimization.processing_time_ms,
        status: optimization.status,
        notes: optimization.optimization_notes,
        createdAt: optimization.created_at,
        completedAt: optimization.completed_at
      }
    });
  } catch (error) {
    logger.error('Get optimization error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'GET_OPTIMIZATION_ERROR',
        message: 'Error retrieving optimization'
      }
    });
  }
};

// @desc    Get optimization status
// @route   GET /api/v1/optimizations/:id/status
// @access  Private
const getOptimizationStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const db = getDB();

    const result = await db.query(
      'SELECT status, original_match_score, optimized_match_score, processing_time_ms, completed_at FROM optimizations WHERE id = $1 AND user_id = $2',
      [id, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'OPTIMIZATION_NOT_FOUND',
          message: 'Optimization not found'
        }
      });
    }

    const optimization = result.rows[0];

    res.status(200).json({
      success: true,
      data: {
        status: optimization.status,
        originalMatchScore: optimization.original_match_score,
        optimizedMatchScore: optimization.optimized_match_score,
        processingTime: optimization.processing_time_ms,
        completedAt: optimization.completed_at,
        improvement: optimization.optimized_match_score 
          ? optimization.optimized_match_score - optimization.original_match_score 
          : null
      }
    });
  } catch (error) {
    logger.error('Get optimization status error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'GET_STATUS_ERROR',
        message: 'Error retrieving optimization status'
      }
    });
  }
};

// @desc    Calculate match score
// @route   POST /api/v1/optimizations/match-score
// @access  Private
const calculateMatchScore = async (req, res) => {
  try {
    const { resumeId, jobDescriptionId } = req.body;
    const userId = req.user.id;
    const db = getDB();

    if (!resumeId || !jobDescriptionId) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Resume ID and Job Description ID are required'
        }
      });
    }

    // Check cache first
    const cacheKey = cacheService.generateKey('matchScore', userId, resumeId, jobDescriptionId);
    const cachedScore = await cacheService.get(cacheKey);
    
    if (cachedScore) {
      return res.status(200).json({
        success: true,
        data: cachedScore,
        fromCache: true
      });
    }

    // Get resume data
    const resumeResult = await db.query(
      'SELECT parsed_data FROM resumes WHERE id = $1 AND user_id = $2 AND status = $3',
      [resumeId, userId, 'active']
    );

    if (resumeResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'RESUME_NOT_FOUND',
          message: 'Resume not found'
        }
      });
    }

    // Get job keywords
    const jobResult = await db.query(
      'SELECT parsed_keywords FROM job_descriptions WHERE id = $1 AND user_id = $2',
      [jobDescriptionId, userId]
    );

    if (jobResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'JOB_NOT_FOUND',
          message: 'Job description not found'
        }
      });
    }

    const resumeData = resumeResult.rows[0].parsed_data;
    const jobKeywords = jobResult.rows[0].parsed_keywords;

    // Calculate match score using worker
    const matchScore = await workerPool.runTask('MATCH_SCORE', {
      resumeData,
      jobKeywords
    });

    // Cache the result
    await cacheService.set(cacheKey, matchScore, {
      ttl: cacheService.ttlStrategies.matchScore
    });

    res.status(200).json({
      success: true,
      data: matchScore
    });
  } catch (error) {
    logger.error('Calculate match score error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'MATCH_SCORE_ERROR',
        message: 'Error calculating match score'
      }
    });
  }
};

module.exports = {
  createOptimization,
  getOptimizations,
  getOptimization,
  getOptimizationStatus,
  calculateMatchScore
};