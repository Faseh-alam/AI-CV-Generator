const BaseRepository = require('./baseRepository');
const format = require('pg-format');
const logger = require('../utils/logger');

class JobRepository extends BaseRepository {
  constructor() {
    super('job_descriptions');
  }

  async createJobWithKeywords(jobData, keywords) {
    return this.withTransaction(async (client) => {
      // Safe parameterized query for job creation
      const jobResult = await client.query(
        `INSERT INTO job_descriptions 
         (user_id, title, company, description, requirements, parsed_keywords, industry, job_level, location, salary_range) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) 
         RETURNING *`,
        [
          jobData.userId,
          jobData.title,
          jobData.company,
          jobData.description,
          jobData.requirements,
          JSON.stringify(keywords),
          jobData.industry,
          jobData.jobLevel,
          jobData.location,
          jobData.salaryRange
        ]
      );

      const job = jobResult.rows[0];

      // Safe bulk insert using pg-format for keywords
      if (keywords && keywords.length > 0) {
        const keywordValues = keywords.map(k => [
          job.id,
          k.term,
          k.importance || 50,
          k.category || 'general',
          k.frequency || 1,
          k.type === 'required'
        ]);

        const keywordQuery = format(
          `INSERT INTO keyword_analysis 
           (job_description_id, keyword, importance_score, category, frequency, is_required) 
           VALUES %L`,
          keywordValues
        );

        await client.query(keywordQuery);
      }

      logger.info('Job created with keywords', { 
        jobId: job.id, 
        keywordCount: keywords?.length || 0 
      });

      return job;
    });
  }

  async searchJobs(userId, filters = {}) {
    try {
      let query = `
        SELECT j.*, COUNT(k.id) as keyword_count
        FROM job_descriptions j
        LEFT JOIN keyword_analysis k ON j.id = k.job_description_id
        WHERE j.user_id = $1
      `;
      
      const params = [userId];
      let paramIndex = 2;

      // Add filters with parameterized queries
      if (filters.industry) {
        query += ` AND j.industry = $${paramIndex}`;
        params.push(filters.industry);
        paramIndex++;
      }

      if (filters.jobLevel) {
        query += ` AND j.job_level = $${paramIndex}`;
        params.push(filters.jobLevel);
        paramIndex++;
      }

      if (filters.company) {
        query += ` AND j.company ILIKE $${paramIndex}`;
        params.push(`%${filters.company}%`);
        paramIndex++;
      }

      if (filters.keywords && filters.keywords.length > 0) {
        // Use ANY for safe array parameter
        query += ` AND k.keyword = ANY($${paramIndex})`;
        params.push(filters.keywords);
        paramIndex++;
      }

      if (filters.dateFrom) {
        query += ` AND j.created_at >= $${paramIndex}`;
        params.push(filters.dateFrom);
        paramIndex++;
      }

      if (filters.dateTo) {
        query += ` AND j.created_at <= $${paramIndex}`;
        params.push(filters.dateTo);
        paramIndex++;
      }

      query += ` GROUP BY j.id ORDER BY j.created_at DESC`;

      if (filters.limit) {
        query += ` LIMIT $${paramIndex}`;
        params.push(filters.limit);
        paramIndex++;
      }

      if (filters.offset) {
        query += ` OFFSET $${paramIndex}`;
        params.push(filters.offset);
      }

      const result = await this.db.query(query, params);
      return result.rows;
    } catch (error) {
      logger.error('Error searching jobs', { userId, filters, error: error.message });
      throw error;
    }
  }

  async getJobWithKeywords(jobId, userId) {
    try {
      const jobResult = await this.db.query(
        'SELECT * FROM job_descriptions WHERE id = $1 AND user_id = $2',
        [jobId, userId]
      );

      if (jobResult.rows.length === 0) {
        return null;
      }

      const job = jobResult.rows[0];

      // Get detailed keywords
      const keywordsResult = await this.db.query(
        `SELECT keyword, importance_score, category, frequency, is_required 
         FROM keyword_analysis 
         WHERE job_description_id = $1 
         ORDER BY importance_score DESC`,
        [jobId]
      );

      return {
        ...job,
        detailedKeywords: keywordsResult.rows
      };
    } catch (error) {
      logger.error('Error getting job with keywords', { jobId, userId, error: error.message });
      throw error;
    }
  }

  async updateJobKeywords(jobId, userId, keywords) {
    return this.withTransaction(async (client) => {
      // Verify job ownership
      const jobCheck = await client.query(
        'SELECT id FROM job_descriptions WHERE id = $1 AND user_id = $2',
        [jobId, userId]
      );

      if (jobCheck.rows.length === 0) {
        throw new Error('Job not found or access denied');
      }

      // Delete existing keywords
      await client.query(
        'DELETE FROM keyword_analysis WHERE job_description_id = $1',
        [jobId]
      );

      // Insert new keywords if provided
      if (keywords && keywords.length > 0) {
        const keywordValues = keywords.map(k => [
          jobId,
          k.term,
          k.importance || 50,
          k.category || 'general',
          k.frequency || 1,
          k.type === 'required'
        ]);

        const keywordQuery = format(
          `INSERT INTO keyword_analysis 
           (job_description_id, keyword, importance_score, category, frequency, is_required) 
           VALUES %L`,
          keywordValues
        );

        await client.query(keywordQuery);
      }

      // Update parsed_keywords in job_descriptions
      await client.query(
        'UPDATE job_descriptions SET parsed_keywords = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
        [JSON.stringify(keywords), jobId]
      );

      logger.info('Job keywords updated', { jobId, keywordCount: keywords?.length || 0 });
      return true;
    });
  }

  async getJobsByIndustry(userId, industry, limit = 10) {
    try {
      const result = await this.db.query(
        `SELECT id, title, company, created_at 
         FROM job_descriptions 
         WHERE user_id = $1 AND industry = $2 
         ORDER BY created_at DESC 
         LIMIT $3`,
        [userId, industry, limit]
      );

      return result.rows;
    } catch (error) {
      logger.error('Error getting jobs by industry', { userId, industry, error: error.message });
      throw error;
    }
  }

  async getPopularKeywords(userId, limit = 20) {
    try {
      const result = await this.db.query(
        `SELECT k.keyword, k.category, COUNT(*) as usage_count, AVG(k.importance_score) as avg_importance
         FROM keyword_analysis k
         JOIN job_descriptions j ON k.job_description_id = j.id
         WHERE j.user_id = $1
         GROUP BY k.keyword, k.category
         ORDER BY usage_count DESC, avg_importance DESC
         LIMIT $2`,
        [userId, limit]
      );

      return result.rows;
    } catch (error) {
      logger.error('Error getting popular keywords', { userId, error: error.message });
      throw error;
    }
  }

  async getJobStatistics(userId) {
    try {
      const result = await this.db.query(
        `SELECT 
           COUNT(*) as total_jobs,
           COUNT(DISTINCT industry) as industries_count,
           COUNT(DISTINCT job_level) as job_levels_count,
           AVG(array_length(string_to_array(description, ' '), 1)) as avg_description_length
         FROM job_descriptions 
         WHERE user_id = $1`,
        [userId]
      );

      const industryResult = await this.db.query(
        `SELECT industry, COUNT(*) as count
         FROM job_descriptions 
         WHERE user_id = $1 AND industry IS NOT NULL
         GROUP BY industry
         ORDER BY count DESC`,
        [userId]
      );

      return {
        ...result.rows[0],
        industries: industryResult.rows
      };
    } catch (error) {
      logger.error('Error getting job statistics', { userId, error: error.message });
      throw error;
    }
  }
}

module.exports = JobRepository;