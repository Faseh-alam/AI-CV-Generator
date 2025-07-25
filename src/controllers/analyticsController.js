const { getDB } = require('../config/database');
const logger = require('../utils/logger');
const { validateApplication } = require('../utils/validation');
const CacheService = require('../services/cacheService');

// Initialize cache service
const cacheService = new CacheService();

// @desc    Get user dashboard data
// @route   GET /api/v1/analytics/dashboard
// @access  Private
const getUserDashboard = async (req, res) => {
  try {
    const userId = req.user.id;
    const db = getDB();

    // Check cache first
    const cacheKey = cacheService.generateKey('userDashboard', userId);
    const cachedDashboard = await cacheService.get(cacheKey);
    
    if (cachedDashboard) {
      return res.status(200).json({
        success: true,
        data: cachedDashboard,
        fromCache: true
      });
    }

    // Get current month stats
    const currentMonth = new Date();
    const firstDayOfMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1);

    // Execute all queries in parallel for better performance
    const [
      optimizationResult,
      matchScoreResult,
      applicationResult,
      recentOptimizations,
      subscriptionResult
    ] = await Promise.all([
      db.query(
        'SELECT COUNT(*) as count FROM optimizations WHERE user_id = $1 AND created_at >= $2',
        [userId, firstDayOfMonth]
      ),
      db.query(
        `SELECT AVG(optimized_match_score - original_match_score) as avg_improvement,
                AVG(optimized_match_score) as avg_optimized_score
         FROM optimizations 
         WHERE user_id = $1 AND status = 'completed' AND created_at >= $2`,
        [userId, firstDayOfMonth]
      ),
      db.query(
        'SELECT COUNT(*) as count FROM applications WHERE user_id = $1 AND application_date >= $2',
        [userId, firstDayOfMonth]
      ),
      db.query(
        `SELECT o.id, o.original_match_score, o.optimized_match_score, o.status, o.created_at,
                r.name as resume_name, j.title as job_title, j.company
         FROM optimizations o
         JOIN resumes r ON o.resume_id = r.id
         JOIN job_descriptions j ON o.job_description_id = j.id
         WHERE o.user_id = $1
         ORDER BY o.created_at DESC
         LIMIT 5`,
        [userId]
      ),
      db.query(
        'SELECT subscription_tier, subscription_status FROM users WHERE id = $1',
        [userId]
      )
    ]);

    const user = subscriptionResult.rows[0];
    const dashboardData = {
      currentMonth: {
        optimizations: parseInt(optimizationResult.rows[0].count),
        avgMatchScore: Math.round(matchScoreResult.rows[0].avg_optimized_score || 0),
        avgImprovement: Math.round(matchScoreResult.rows[0].avg_improvement || 0),
        applications: parseInt(applicationResult.rows[0].count)
      },
      recentOptimizations: recentOptimizations.rows,
      subscription: {
        tier: user.subscription_tier,
        status: user.subscription_status
      }
    };

    // Cache the dashboard data
    await cacheService.set(cacheKey, dashboardData, {
      ttl: cacheService.ttlStrategies.userStats
    });

    res.status(200).json({
      success: true,
      data: dashboardData
    });
  } catch (error) {
    logger.error('Get dashboard error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'DASHBOARD_ERROR',
        message: 'Error retrieving dashboard data'
      }
    });
  }
};

// @desc    Get usage statistics
// @route   GET /api/v1/analytics/usage
// @access  Private
const getUsageStats = async (req, res) => {
  try {
    const userId = req.user.id;
    const { period = '30' } = req.query; // days
    const db = getDB();

    // Check cache first
    const cacheKey = cacheService.generateKey('usageStats', userId, period);
    const cachedStats = await cacheService.get(cacheKey);
    
    if (cachedStats) {
      return res.status(200).json({
        success: true,
        data: cachedStats,
        fromCache: true
      });
    }

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - parseInt(period));

    // Execute queries in parallel
    const [usageResult, totalResult, optimizationStats] = await Promise.all([
      db.query(
        `SELECT action, COUNT(*) as count, DATE(timestamp) as date
         FROM usage_tracking 
         WHERE user_id = $1 AND timestamp >= $2
         GROUP BY action, DATE(timestamp)
         ORDER BY date DESC`,
        [userId, startDate]
      ),
      db.query(
        `SELECT action, COUNT(*) as total
         FROM usage_tracking 
         WHERE user_id = $1 AND timestamp >= $2
         GROUP BY action`,
        [userId, startDate]
      ),
      db.query(
        `SELECT status, COUNT(*) as count
         FROM optimizations 
         WHERE user_id = $1 AND created_at >= $2
         GROUP BY status`,
        [userId, startDate]
      )
    ]);

    const statsData = {
      period: `${period} days`,
      dailyUsage: usageResult.rows,
      totalUsage: totalResult.rows,
      optimizationStats: optimizationStats.rows
    };

    // Cache the stats
    await cacheService.set(cacheKey, statsData, {
      ttl: cacheService.ttlStrategies.userStats
    });

    res.status(200).json({
      success: true,
      data: statsData
    });
  } catch (error) {
    logger.error('Get usage stats error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'USAGE_STATS_ERROR',
        message: 'Error retrieving usage statistics'
      }
    });
  }
};

// @desc    Get optimization history
// @route   GET /api/v1/analytics/optimization-history
// @access  Private
const getOptimizationHistory = async (req, res) => {
  try {
    const userId = req.user.id;
    const { limit = 20, offset = 0 } = req.query;
    const db = getDB();

    const result = await db.query(
      `SELECT o.id, o.original_match_score, o.optimized_match_score, 
              o.status, o.created_at, o.completed_at, o.processing_time_ms,
              r.name as resume_name, j.title as job_title, j.company,
              (o.optimized_match_score - o.original_match_score) as improvement
       FROM optimizations o
       JOIN resumes r ON o.resume_id = r.id
       JOIN job_descriptions j ON o.job_description_id = j.id
       WHERE o.user_id = $1
       ORDER BY o.created_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    );

    // Get total count for pagination
    const countResult = await db.query(
      'SELECT COUNT(*) as total FROM optimizations WHERE user_id = $1',
      [userId]
    );

    res.status(200).json({
      success: true,
      data: {
        optimizations: result.rows,
        pagination: {
          total: parseInt(countResult.rows[0].total),
          limit: parseInt(limit),
          offset: parseInt(offset),
          hasMore: parseInt(offset) + parseInt(limit) < parseInt(countResult.rows[0].total)
        }
      }
    });
  } catch (error) {
    logger.error('Get optimization history error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'OPTIMIZATION_HISTORY_ERROR',
        message: 'Error retrieving optimization history'
      }
    });
  }
};

// @desc    Get application tracking data
// @route   GET /api/v1/analytics/applications
// @access  Private
const getApplicationTracking = async (req, res) => {
  try {
    const userId = req.user.id;
    const { status, limit = 50, offset = 0 } = req.query;
    const db = getDB();

    let query = `
      SELECT a.*, o.optimized_match_score
      FROM applications a
      LEFT JOIN optimizations o ON a.optimization_id = o.id
      WHERE a.user_id = $1
    `;
    const params = [userId];

    if (status) {
      query += ` AND a.status = $${params.length + 1}`;
      params.push(status);
    }

    query += ` ORDER BY a.application_date DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const result = await db.query(query, params);

    // Get application statistics
    const statsResult = await db.query(
      `SELECT status, COUNT(*) as count
       FROM applications 
       WHERE user_id = $1
       GROUP BY status`,
      [userId]
    );

    // Get response rate
    const responseResult = await db.query(
      `SELECT 
         COUNT(*) as total_applications,
         COUNT(CASE WHEN status IN ('interview', 'offer') THEN 1 END) as responses
       FROM applications 
       WHERE user_id = $1`,
      [userId]
    );

    const responseData = responseResult.rows[0];
    const responseRate = responseData.total_applications > 0 
      ? Math.round((responseData.responses / responseData.total_applications) * 100)
      : 0;

    res.status(200).json({
      success: true,
      data: {
        applications: result.rows,
        statistics: {
          byStatus: statsResult.rows,
          responseRate,
          totalApplications: parseInt(responseData.total_applications)
        }
      }
    });
  } catch (error) {
    logger.error('Get application tracking error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'APPLICATION_TRACKING_ERROR',
        message: 'Error retrieving application tracking data'
      }
    });
  }
};

// @desc    Create application record
// @route   POST /api/v1/analytics/applications
// @access  Private
const createApplication = async (req, res) => {
  try {
    const { error } = validateApplication(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: error.details[0].message
        }
      });
    }

    const {
      companyName,
      jobTitle,
      applicationDate,
      status = 'applied',
      responseDate,
      interviewDate,
      notes,
      optimizationId
    } = req.body;

    const userId = req.user.id;
    const db = getDB();

    // Verify optimization belongs to user if provided
    if (optimizationId) {
      const optimizationCheck = await db.query(
        'SELECT id FROM optimizations WHERE id = $1 AND user_id = $2',
        [optimizationId, userId]
      );

      if (optimizationCheck.rows.length === 0) {
        return res.status(404).json({
          success: false,
          error: {
            code: 'OPTIMIZATION_NOT_FOUND',
            message: 'Optimization not found'
          }
        });
      }
    }

    const result = await db.query(
      `INSERT INTO applications (user_id, optimization_id, company_name, job_title, 
                                application_date, status, response_date, interview_date, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, company_name, job_title, application_date, status, created_at`,
      [userId, optimizationId, companyName, jobTitle, applicationDate, status, responseDate, interviewDate, notes]
    );

    const application = result.rows[0];

    logger.info(`Application created by user ${userId}: ${application.id}`);

    res.status(201).json({
      success: true,
      data: {
        id: application.id,
        companyName: application.company_name,
        jobTitle: application.job_title,
        applicationDate: application.application_date,
        status: application.status,
        createdAt: application.created_at
      }
    });
  } catch (error) {
    logger.error('Create application error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'CREATE_APPLICATION_ERROR',
        message: 'Error creating application record'
      }
    });
  }
};

// @desc    Update application record
// @route   PUT /api/v1/analytics/applications/:id
// @access  Private
const updateApplication = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const {
      status,
      responseDate,
      interviewDate,
      notes
    } = req.body;

    const db = getDB();

    // Check if application exists and belongs to user
    const existingApp = await db.query(
      'SELECT id FROM applications WHERE id = $1 AND user_id = $2',
      [id, userId]
    );

    if (existingApp.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'APPLICATION_NOT_FOUND',
          message: 'Application not found'
        }
      });
    }

    // Update application
    const result = await db.query(
      `UPDATE applications 
       SET status = COALESCE($1, status),
           response_date = COALESCE($2, response_date),
           interview_date = COALESCE($3, interview_date),
           notes = COALESCE($4, notes),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $5 AND user_id = $6
       RETURNING id, company_name, job_title, status, updated_at`,
      [status, responseDate, interviewDate, notes, id, userId]
    );

    const updatedApp = result.rows[0];

    logger.info(`Application updated by user ${userId}: ${id}`);

    res.status(200).json({
      success: true,
      data: {
        id: updatedApp.id,
        companyName: updatedApp.company_name,
        jobTitle: updatedApp.job_title,
        status: updatedApp.status,
        updatedAt: updatedApp.updated_at
      }
    });
  } catch (error) {
    logger.error('Update application error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'UPDATE_APPLICATION_ERROR',
        message: 'Error updating application record'
      }
    });
  }
};

module.exports = {
  getUserDashboard,
  getUsageStats,
  getOptimizationHistory,
  getApplicationTracking,
  createApplication,
  updateApplication
};