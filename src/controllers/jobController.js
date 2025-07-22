const { getDB } = require('../config/database');
const logger = require('../utils/logger');
const { validateJobDescription } = require('../utils/validation');
const { analyzeJobWithClaude } = require('../utils/claudeAI');
const { extractJobKeywords, classifyJobLevel, detectIndustry } = require('../utils/jobAnalyzer');

// @desc    Analyze job description
// @route   POST /api/v1/jobs
// @access  Private
const analyzeJobDescription = async (req, res) => {
  try {
    const { error } = validateJobDescription(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: error.details[0].message
        }
      });
    }

    const { title, company, description, requirements, location, salaryRange, url } = req.body;
    const userId = req.user.id;
    const db = getDB();

    // Analyze job description with Claude AI
    const analysis = await analyzeJobWithClaude(description, requirements);
    
    // Extract additional metadata
    const industry = detectIndustry(description);
    const jobLevel = classifyJobLevel(title, description);

    // Save to database
    const result = await db.query(
      `INSERT INTO job_descriptions (user_id, title, company, description, requirements, parsed_keywords, industry, job_level, location, salary_range) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) 
       RETURNING id, title, company, created_at`,
      [userId, title, company, description, requirements, JSON.stringify(analysis.keywords), industry, jobLevel, location, salaryRange]
    );

    const jobAnalysis = result.rows[0];

    // Save individual keywords to keyword_analysis table
    if (analysis.keywords && analysis.keywords.length > 0) {
      const keywordInserts = analysis.keywords.map(keyword => [
        jobAnalysis.id,
        keyword.term,
        keyword.importance,
        keyword.category,
        keyword.frequency || 1,
        keyword.type === 'required'
      ]);

      const keywordQuery = `
        INSERT INTO keyword_analysis (job_description_id, keyword, importance_score, category, frequency, is_required)
        VALUES ${keywordInserts.map((_, i) => `($${i * 6 + 1}, $${i * 6 + 2}, $${i * 6 + 3}, $${i * 6 + 4}, $${i * 6 + 5}, $${i * 6 + 6})`).join(', ')}
      `;

      await db.query(keywordQuery, keywordInserts.flat());
    }

    logger.info(`Job description analyzed by user ${userId}: ${jobAnalysis.id}`);

    res.status(201).json({
      success: true,
      data: {
        jobId: jobAnalysis.id,
        title: jobAnalysis.title,
        company: jobAnalysis.company,
        extractedKeywords: analysis.keywords,
        requirements: analysis.requirements,
        industry,
        jobLevel,
        createdAt: jobAnalysis.created_at
      }
    });
  } catch (error) {
    logger.error('Job analysis error:', error);
    
    if (error.message.includes('Claude API')) {
      return res.status(503).json({
        success: false,
        error: {
          code: 'AI_SERVICE_ERROR',
          message: 'AI analysis service temporarily unavailable'
        }
      });
    }

    res.status(500).json({
      success: false,
      error: {
        code: 'ANALYSIS_ERROR',
        message: 'Error analyzing job description'
      }
    });
  }
};

// @desc    Get all user job analyses
// @route   GET /api/v1/jobs
// @access  Private
const getJobAnalyses = async (req, res) => {
  try {
    const userId = req.user.id;
    const db = getDB();

    const result = await db.query(
      `SELECT id, title, company, industry, job_level, location, salary_range, created_at, updated_at 
       FROM job_descriptions 
       WHERE user_id = $1 
       ORDER BY created_at DESC`,
      [userId]
    );

    res.status(200).json({
      success: true,
      count: result.rows.length,
      data: result.rows
    });
  } catch (error) {
    logger.error('Get job analyses error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'GET_JOBS_ERROR',
        message: 'Error retrieving job analyses'
      }
    });
  }
};

// @desc    Get single job analysis
// @route   GET /api/v1/jobs/:id
// @access  Private
const getJobAnalysis = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const db = getDB();

    const result = await db.query(
      `SELECT id, title, company, description, requirements, parsed_keywords, industry, job_level, location, salary_range, created_at, updated_at 
       FROM job_descriptions 
       WHERE id = $1 AND user_id = $2`,
      [id, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'JOB_NOT_FOUND',
          message: 'Job analysis not found'
        }
      });
    }

    const job = result.rows[0];

    // Get detailed keyword analysis
    const keywordResult = await db.query(
      'SELECT keyword, importance_score, category, frequency, is_required FROM keyword_analysis WHERE job_description_id = $1 ORDER BY importance_score DESC',
      [id]
    );

    res.status(200).json({
      success: true,
      data: {
        id: job.id,
        title: job.title,
        company: job.company,
        description: job.description,
        requirements: job.requirements,
        keywords: job.parsed_keywords,
        detailedKeywords: keywordResult.rows,
        industry: job.industry,
        jobLevel: job.job_level,
        location: job.location,
        salaryRange: job.salary_range,
        createdAt: job.created_at,
        updatedAt: job.updated_at
      }
    });
  } catch (error) {
    logger.error('Get job analysis error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'GET_JOB_ERROR',
        message: 'Error retrieving job analysis'
      }
    });
  }
};

// @desc    Update job analysis
// @route   PUT /api/v1/jobs/:id
// @access  Private
const updateJobAnalysis = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const { title, company, description, requirements, location, salaryRange } = req.body;
    const db = getDB();

    // Check if job exists and belongs to user
    const existingJob = await db.query(
      'SELECT id FROM job_descriptions WHERE id = $1 AND user_id = $2',
      [id, userId]
    );

    if (existingJob.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'JOB_NOT_FOUND',
          message: 'Job analysis not found'
        }
      });
    }

    // Update job analysis
    const result = await db.query(
      `UPDATE job_descriptions 
       SET title = COALESCE($1, title), 
           company = COALESCE($2, company), 
           description = COALESCE($3, description), 
           requirements = COALESCE($4, requirements), 
           location = COALESCE($5, location), 
           salary_range = COALESCE($6, salary_range),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $7 AND user_id = $8 
       RETURNING id, title, company, updated_at`,
      [title, company, description, requirements, location, salaryRange, id, userId]
    );

    const updatedJob = result.rows[0];

    logger.info(`Job analysis updated by user ${userId}: ${id}`);

    res.status(200).json({
      success: true,
      data: {
        id: updatedJob.id,
        title: updatedJob.title,
        company: updatedJob.company,
        updatedAt: updatedJob.updated_at
      }
    });
  } catch (error) {
    logger.error('Update job analysis error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'UPDATE_JOB_ERROR',
        message: 'Error updating job analysis'
      }
    });
  }
};

// @desc    Delete job analysis
// @route   DELETE /api/v1/jobs/:id
// @access  Private
const deleteJobAnalysis = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const db = getDB();

    // Check if job exists and belongs to user
    const existingJob = await db.query(
      'SELECT id FROM job_descriptions WHERE id = $1 AND user_id = $2',
      [id, userId]
    );

    if (existingJob.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'JOB_NOT_FOUND',
          message: 'Job analysis not found'
        }
      });
    }

    // Delete job analysis (cascade will handle related records)
    await db.query('DELETE FROM job_descriptions WHERE id = $1', [id]);

    logger.info(`Job analysis deleted by user ${userId}: ${id}`);

    res.status(200).json({
      success: true,
      data: {
        message: 'Job analysis deleted successfully'
      }
    });
  } catch (error) {
    logger.error('Delete job analysis error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'DELETE_JOB_ERROR',
        message: 'Error deleting job analysis'
      }
    });
  }
};

// @desc    Classify job type
// @route   POST /api/v1/jobs/classify
// @access  Private
const classifyJob = async (req, res) => {
  try {
    const { description, title } = req.body;

    if (!description) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Job description is required'
        }
      });
    }

    const industry = detectIndustry(description);
    const jobLevel = classifyJobLevel(title || '', description);
    const workArrangement = detectWorkArrangement(description);

    res.status(200).json({
      success: true,
      data: {
        industry,
        jobLevel,
        workArrangement,
        suggestedTitles: getSuggestedTitles(industry, jobLevel)
      }
    });
  } catch (error) {
    logger.error('Job classification error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'CLASSIFICATION_ERROR',
        message: 'Error classifying job'
      }
    });
  }
};

// @desc    Extract keywords from job
// @route   GET /api/v1/jobs/:id/keywords
// @access  Private
const extractKeywords = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const db = getDB();

    // Get job and verify ownership
    const jobResult = await db.query(
      'SELECT description, requirements FROM job_descriptions WHERE id = $1 AND user_id = $2',
      [id, userId]
    );

    if (jobResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'JOB_NOT_FOUND',
          message: 'Job analysis not found'
        }
      });
    }

    // Get keywords from database
    const keywordResult = await db.query(
      `SELECT keyword, importance_score, category, frequency, is_required 
       FROM keyword_analysis 
       WHERE job_description_id = $1 
       ORDER BY importance_score DESC`,
      [id]
    );

    res.status(200).json({
      success: true,
      data: {
        keywords: keywordResult.rows,
        totalKeywords: keywordResult.rows.length,
        requiredKeywords: keywordResult.rows.filter(k => k.is_required).length
      }
    });
  } catch (error) {
    logger.error('Extract keywords error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'EXTRACT_KEYWORDS_ERROR',
        message: 'Error extracting keywords'
      }
    });
  }
};

// Helper functions
const detectWorkArrangement = (description) => {
  const text = description.toLowerCase();
  
  if (text.includes('remote') || text.includes('work from home')) {
    return 'remote';
  } else if (text.includes('hybrid')) {
    return 'hybrid';
  } else {
    return 'onsite';
  }
};

const getSuggestedTitles = (industry, jobLevel) => {
  const titleMap = {
    'Technology': {
      'entry': ['Junior Developer', 'Software Engineer I', 'Associate Developer'],
      'mid': ['Software Engineer', 'Full Stack Developer', 'Backend Developer'],
      'senior': ['Senior Software Engineer', 'Lead Developer', 'Principal Engineer'],
      'executive': ['Engineering Manager', 'VP of Engineering', 'CTO']
    },
    'Marketing': {
      'entry': ['Marketing Coordinator', 'Digital Marketing Assistant', 'Content Creator'],
      'mid': ['Marketing Specialist', 'Digital Marketing Manager', 'Content Manager'],
      'senior': ['Senior Marketing Manager', 'Marketing Director', 'Brand Manager'],
      'executive': ['VP of Marketing', 'Chief Marketing Officer', 'Head of Marketing']
    }
    // Add more industries as needed
  };

  return titleMap[industry]?.[jobLevel] || [];
};

module.exports = {
  analyzeJobDescription,
  getJobAnalyses,
  getJobAnalysis,
  updateJobAnalysis,
  deleteJobAnalysis,
  classifyJob,
  extractKeywords
};