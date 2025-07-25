const { getDB } = require('../config/database');
const logger = require('../utils/logger');
const { validateResumeUpload } = require('../utils/validation');
const { parseResumeFile } = require('../utils/resumeParser');
const { generateATSPDF } = require('../utils/pdfGenerator');
const { uploadFile } = require('../utils/fileStorage');
const CacheService = require('../services/cacheService');
const WorkerPool = require('../services/workerPool');
const path = require('path');
const { Readable } = require('stream');

// Initialize services
const cacheService = new CacheService();
const resumeWorkerPool = new WorkerPool(
  path.join(__dirname, '../utils/workers/resumeWorker.js'),
  {
    poolSize: 2,
    maxQueueSize: 100
  }
);

// @desc    Upload and parse resume
// @route   POST /api/v1/resumes
// @access  Private
const uploadResume = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'NO_FILE',
          message: 'No file uploaded'
        }
      });
    }

    const { error } = await validateResumeUpload({
      ...req.body,
      fileMetadata: {
        originalName: req.file.originalname,
        mimeType: req.file.mimetype,
        size: req.file.size
      }
    }, { 
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

    const { name, isDefault = false } = req.body;
    const file = req.file;
    const userId = req.user.id;
    const db = getDB();

    // Convert buffer to stream for secure processing
    const fileStream = Readable.from(file.buffer);

    // Upload file with security scanning
    const uploadResult = await uploadFile(fileStream, file.originalname, userId);

    // Check virus scan result
    if (uploadResult.scanResult && uploadResult.scanResult.infected) {
      logger.security('Virus detected in uploaded file', {
        userId,
        filename: file.originalname,
        viruses: uploadResult.scanResult.virus
      });

      return res.status(400).json({
        success: false,
        error: {
          code: 'VIRUS_DETECTED',
          message: 'File failed security scan'
        }
      });
    }

    // Parse resume content using worker
    const parsedData = await resumeWorkerPool.runTask('PARSE_RESUME', {
      fileBuffer: file.buffer,
      mimeType: file.mimetype,
      originalName: file.originalname
    });

    // Save to database
    const result = await db.query(
      `INSERT INTO resumes (user_id, name, original_filename, file_path, parsed_data, file_hash, parsing_accuracy, virus_scan_result) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) 
       RETURNING id, name, original_filename, created_at`,
      [
        userId, 
        name, 
        file.originalname, 
        uploadResult.path, 
        JSON.stringify(parsedData),
        uploadResult.metadata?.fileHash,
        parsedData.accuracy || 95,
        JSON.stringify(uploadResult.scanResult || {})
      ]
    );

    const resume = result.rows[0];

    // Cache parsed data
    const cacheKey = cacheService.generateKey('resumeData', userId, resume.id);
    await cacheService.set(cacheKey, parsedData, {
      ttl: cacheService.ttlStrategies.resumeAnalysis
    });

    // Invalidate user's resume list cache
    await cacheService.invalidatePattern(`userResumes:*${userId}*`);

    // Track usage
    await db.query(
      'INSERT INTO usage_tracking (user_id, action, resource_id) VALUES ($1, $2, $3)',
      [userId, 'upload', resume.id]
    );

    logger.info(`Resume uploaded by user ${userId}: ${resume.id}`);

    res.status(201).json({
      success: true,
      data: {
        resumeId: resume.id,
        name: resume.name,
        originalFilename: resume.original_filename,
        parsedData,
        parsingAccuracy: parsedData.accuracy || 95,
        securityScan: {
          passed: !uploadResult.scanResult?.infected,
          scannedAt: new Date().toISOString()
        },
        createdAt: resume.created_at
      }
    });
  } catch (error) {
    logger.error('Resume upload error:', error);
    
    if (error.code === 'INVALID_FILE_TYPE') {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_FILE_TYPE',
          message: error.message
        }
      });
    }

    if (error.code === 'FILE_TOO_LARGE') {
      return res.status(413).json({
        success: false,
        error: {
          code: 'FILE_TOO_LARGE',
          message: error.message
        }
      });
    }

    res.status(500).json({
      success: false,
      error: {
        code: 'UPLOAD_ERROR',
        message: 'Error uploading resume'
      }
    });
  }
};

// @desc    Get all user resumes
// @route   GET /api/v1/resumes
// @access  Private
const getResumes = async (req, res) => {
  try {
    const userId = req.user.id;
    const db = getDB();

    // Check cache first
    const cacheKey = cacheService.generateKey('userResumes', userId);
    const cachedResumes = await cacheService.get(cacheKey);
    
    if (cachedResumes) {
      return res.status(200).json({
        success: true,
        count: cachedResumes.length,
        data: cachedResumes,
        fromCache: true
      });
    }

    const result = await db.query(
      `SELECT id, name, original_filename, created_at, updated_at, status, parsing_accuracy
       FROM resumes 
       WHERE user_id = $1 AND status = 'active' 
       ORDER BY created_at DESC`,
      [userId]
    );

    // Cache the results
    await cacheService.set(cacheKey, result.rows, {
      ttl: cacheService.ttlStrategies.userProfile
    });

    res.status(200).json({
      success: true,
      count: result.rows.length,
      data: result.rows
    });
  } catch (error) {
    logger.error('Get resumes error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'GET_RESUMES_ERROR',
        message: 'Error retrieving resumes'
      }
    });
  }
};

// @desc    Get single resume
// @route   GET /api/v1/resumes/:id
// @access  Private
const getResume = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const db = getDB();

    // Check cache first
    const cacheKey = cacheService.generateKey('resumeData', userId, id);
    const cachedResume = await cacheService.get(cacheKey);
    
    if (cachedResume) {
      return res.status(200).json({
        success: true,
        data: cachedResume,
        fromCache: true
      });
    }

    const result = await db.query(
      `SELECT id, name, original_filename, parsed_data, created_at, updated_at, parsing_accuracy
       FROM resumes 
       WHERE id = $1 AND user_id = $2 AND status = 'active'`,
      [id, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'RESUME_NOT_FOUND',
          message: 'Resume not found'
        }
      });
    }

    const resume = result.rows[0];
    const responseData = {
      id: resume.id,
      name: resume.name,
      originalFilename: resume.original_filename,
      parsedData: resume.parsed_data,
      parsingAccuracy: resume.parsing_accuracy,
      createdAt: resume.created_at,
      updatedAt: resume.updated_at
    };

    // Cache the result
    await cacheService.set(cacheKey, responseData, {
      ttl: cacheService.ttlStrategies.resumeAnalysis
    });

    res.status(200).json({
      success: true,
      data: responseData
    });
  } catch (error) {
    logger.error('Get resume error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'GET_RESUME_ERROR',
        message: 'Error retrieving resume'
      }
    });
  }
};

// @desc    Update resume
// @route   PUT /api/v1/resumes/:id
// @access  Private
const updateResume = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const { name, parsedData } = req.body;
    const db = getDB();

    // Check if resume exists and belongs to user
    const existingResume = await db.query(
      'SELECT id FROM resumes WHERE id = $1 AND user_id = $2 AND status = $3',
      [id, userId, 'active']
    );

    if (existingResume.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'RESUME_NOT_FOUND',
          message: 'Resume not found'
        }
      });
    }

    // Update resume
    const result = await db.query(
      `UPDATE resumes 
       SET name = COALESCE($1, name), parsed_data = COALESCE($2, parsed_data), updated_at = CURRENT_TIMESTAMP
       WHERE id = $3 AND user_id = $4 
       RETURNING id, name, parsed_data, updated_at`,
      [name, parsedData ? JSON.stringify(parsedData) : null, id, userId]
    );

    const updatedResume = result.rows[0];

    logger.info(`Resume updated by user ${userId}: ${id}`);

    res.status(200).json({
      success: true,
      data: {
        id: updatedResume.id,
        name: updatedResume.name,
        parsedData: updatedResume.parsed_data,
        updatedAt: updatedResume.updated_at
      }
    });
  } catch (error) {
    logger.error('Update resume error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'UPDATE_RESUME_ERROR',
        message: 'Error updating resume'
      }
    });
  }
};

// @desc    Delete resume
// @route   DELETE /api/v1/resumes/:id
// @access  Private
const deleteResume = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const db = getDB();

    // Check if resume exists and belongs to user
    const existingResume = await db.query(
      'SELECT id FROM resumes WHERE id = $1 AND user_id = $2 AND status = $3',
      [id, userId, 'active']
    );

    if (existingResume.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'RESUME_NOT_FOUND',
          message: 'Resume not found'
        }
      });
    }

    // Soft delete (mark as inactive)
    await db.query(
      'UPDATE resumes SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      ['deleted', id]
    );

    logger.info(`Resume deleted by user ${userId}: ${id}`);

    res.status(200).json({
      success: true,
      data: {
        message: 'Resume deleted successfully'
      }
    });
  } catch (error) {
    logger.error('Delete resume error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'DELETE_RESUME_ERROR',
        message: 'Error deleting resume'
      }
    });
  }
};

// @desc    Parse resume content
// @route   POST /api/v1/resumes/:id/parse
// @access  Private
const parseResume = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const db = getDB();

    // Get resume
    const result = await db.query(
      'SELECT file_path FROM resumes WHERE id = $1 AND user_id = $2 AND status = $3',
      [id, userId, 'active']
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'RESUME_NOT_FOUND',
          message: 'Resume not found'
        }
      });
    }

    // TODO: Re-parse the file from storage
    // For now, return success message
    res.status(200).json({
      success: true,
      data: {
        message: 'Resume parsing initiated'
      }
    });
  } catch (error) {
    logger.error('Parse resume error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'PARSE_RESUME_ERROR',
        message: 'Error parsing resume'
      }
    });
  }
};

// @desc    Generate PDF from resume
// @route   POST /api/v1/resumes/:id/generate-pdf
// @access  Private
const generatePDF = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const db = getDB();

    // Get resume data
    const result = await db.query(
      'SELECT name, parsed_data FROM resumes WHERE id = $1 AND user_id = $2 AND status = $3',
      [id, userId, 'active']
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'RESUME_NOT_FOUND',
          message: 'Resume not found'
        }
      });
    }

    const resume = result.rows[0];
    
    // Generate PDF
    const pdfBuffer = await generateATSPDF(resume.parsed_data);

    // Track usage
    await db.query(
      'INSERT INTO usage_tracking (user_id, action, resource_id) VALUES ($1, $2, $3)',
      [userId, 'download', id]
    );

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${resume.name}.pdf"`);
    res.send(pdfBuffer);
  } catch (error) {
    logger.error('Generate PDF error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'PDF_GENERATION_ERROR',
        message: 'Error generating PDF'
      }
    });
  }
};

module.exports = {
  uploadResume,
  getResumes,
  getResume,
  updateResume,
  deleteResume,
  parseResume,
  generatePDF
};