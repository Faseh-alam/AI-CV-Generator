const { getDB } = require('../config/database');
const logger = require('../utils/logger');
const { validateResumeUpload } = require('../utils/validation');
const { parseResumeFile } = require('../utils/resumeParser');
const { generateATSPDF } = require('../utils/pdfGenerator');
const { uploadToS3 } = require('../utils/fileStorage');

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

    const { error } = validateResumeUpload(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: error.details[0].message
        }
      });
    }

    const { name, isDefault = false } = req.body;
    const file = req.file;
    const userId = req.user.id;
    const db = getDB();

    // Parse resume content
    const parsedData = await parseResumeFile(file);

    // Upload file to storage
    const filePath = await uploadToS3(file.buffer, file.originalname, userId);

    // Save to database
    const result = await db.query(
      `INSERT INTO resumes (user_id, name, original_filename, file_path, parsed_data) 
       VALUES ($1, $2, $3, $4, $5) 
       RETURNING id, name, original_filename, created_at`,
      [userId, name, file.originalname, filePath, JSON.stringify(parsedData)]
    );

    const resume = result.rows[0];

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
        createdAt: resume.created_at
      }
    });
  } catch (error) {
    logger.error('Resume upload error:', error);
    
    if (error.message.includes('Invalid file type')) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_FILE_TYPE',
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

    const result = await db.query(
      `SELECT id, name, original_filename, created_at, updated_at, status 
       FROM resumes 
       WHERE user_id = $1 AND status = 'active' 
       ORDER BY created_at DESC`,
      [userId]
    );

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

    const result = await db.query(
      `SELECT id, name, original_filename, parsed_data, created_at, updated_at 
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

    res.status(200).json({
      success: true,
      data: {
        id: resume.id,
        name: resume.name,
        originalFilename: resume.original_filename,
        parsedData: resume.parsed_data,
        createdAt: resume.created_at,
        updatedAt: resume.updated_at
      }
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