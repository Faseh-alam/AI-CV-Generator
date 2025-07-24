const { getDB } = require('../config/database');
const logger = require('../utils/logger');

class BaseRepository {
  constructor(tableName) {
    this.tableName = tableName;
    this.db = getDB();
  }

  async findById(id) {
    try {
      const result = await this.db.query(
        `SELECT * FROM ${this.tableName} WHERE id = $1`,
        [id]
      );
      return result.rows[0] || null;
    } catch (error) {
      logger.error(`Error finding ${this.tableName} by id`, { id, error: error.message });
      throw error;
    }
  }

  async findByIdAndUser(id, userId) {
    try {
      const result = await this.db.query(
        `SELECT * FROM ${this.tableName} WHERE id = $1 AND user_id = $2`,
        [id, userId]
      );
      return result.rows[0] || null;
    } catch (error) {
      logger.error(`Error finding ${this.tableName} by id and user`, { id, userId, error: error.message });
      throw error;
    }
  }

  async findByUser(userId, options = {}) {
    try {
      let query = `SELECT * FROM ${this.tableName} WHERE user_id = $1`;
      const params = [userId];

      if (options.status) {
        query += ` AND status = $${params.length + 1}`;
        params.push(options.status);
      }

      if (options.orderBy) {
        query += ` ORDER BY ${options.orderBy}`;
        if (options.orderDirection) {
          query += ` ${options.orderDirection}`;
        }
      }

      if (options.limit) {
        query += ` LIMIT $${params.length + 1}`;
        params.push(options.limit);
      }

      if (options.offset) {
        query += ` OFFSET $${params.length + 1}`;
        params.push(options.offset);
      }

      const result = await this.db.query(query, params);
      return result.rows;
    } catch (error) {
      logger.error(`Error finding ${this.tableName} by user`, { userId, error: error.message });
      throw error;
    }
  }

  async create(data) {
    const client = await this.db.connect();
    
    try {
      await client.query('BEGIN');

      const columns = Object.keys(data);
      const values = Object.values(data);
      const placeholders = values.map((_, index) => `$${index + 1}`);

      const query = `
        INSERT INTO ${this.tableName} (${columns.join(', ')})
        VALUES (${placeholders.join(', ')})
        RETURNING *
      `;

      const result = await client.query(query, values);
      
      await client.query('COMMIT');
      
      logger.info(`Created ${this.tableName}`, { id: result.rows[0].id });
      return result.rows[0];
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error(`Error creating ${this.tableName}`, { data, error: error.message });
      throw error;
    } finally {
      client.release();
    }
  }

  async update(id, data) {
    const client = await this.db.connect();
    
    try {
      await client.query('BEGIN');

      const columns = Object.keys(data);
      const values = Object.values(data);
      const setClause = columns.map((col, index) => `${col} = $${index + 2}`).join(', ');

      const query = `
        UPDATE ${this.tableName} 
        SET ${setClause}, updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
        RETURNING *
      `;

      const result = await client.query(query, [id, ...values]);
      
      await client.query('COMMIT');
      
      if (result.rows.length === 0) {
        throw new Error(`${this.tableName} not found`);
      }
      
      logger.info(`Updated ${this.tableName}`, { id });
      return result.rows[0];
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error(`Error updating ${this.tableName}`, { id, data, error: error.message });
      throw error;
    } finally {
      client.release();
    }
  }

  async updateByIdAndUser(id, userId, data) {
    const client = await this.db.connect();
    
    try {
      await client.query('BEGIN');

      const columns = Object.keys(data);
      const values = Object.values(data);
      const setClause = columns.map((col, index) => `${col} = $${index + 3}`).join(', ');

      const query = `
        UPDATE ${this.tableName} 
        SET ${setClause}, updated_at = CURRENT_TIMESTAMP
        WHERE id = $1 AND user_id = $2
        RETURNING *
      `;

      const result = await client.query(query, [id, userId, ...values]);
      
      await client.query('COMMIT');
      
      if (result.rows.length === 0) {
        throw new Error(`${this.tableName} not found or access denied`);
      }
      
      logger.info(`Updated ${this.tableName} by user`, { id, userId });
      return result.rows[0];
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error(`Error updating ${this.tableName} by user`, { id, userId, data, error: error.message });
      throw error;
    } finally {
      client.release();
    }
  }

  async delete(id) {
    try {
      const result = await this.db.query(
        `DELETE FROM ${this.tableName} WHERE id = $1 RETURNING id`,
        [id]
      );
      
      if (result.rows.length === 0) {
        throw new Error(`${this.tableName} not found`);
      }
      
      logger.info(`Deleted ${this.tableName}`, { id });
      return true;
    } catch (error) {
      logger.error(`Error deleting ${this.tableName}`, { id, error: error.message });
      throw error;
    }
  }

  async softDelete(id, userId = null) {
    const whereClause = userId ? 'id = $1 AND user_id = $2' : 'id = $1';
    const params = userId ? [id, userId] : [id];

    try {
      const result = await this.db.query(
        `UPDATE ${this.tableName} 
         SET status = 'deleted', updated_at = CURRENT_TIMESTAMP 
         WHERE ${whereClause} 
         RETURNING id`,
        params
      );
      
      if (result.rows.length === 0) {
        throw new Error(`${this.tableName} not found or access denied`);
      }
      
      logger.info(`Soft deleted ${this.tableName}`, { id, userId });
      return true;
    } catch (error) {
      logger.error(`Error soft deleting ${this.tableName}`, { id, userId, error: error.message });
      throw error;
    }
  }

  async count(conditions = {}) {
    try {
      let query = `SELECT COUNT(*) as count FROM ${this.tableName}`;
      const params = [];
      const whereClauses = [];

      Object.entries(conditions).forEach(([key, value], index) => {
        whereClauses.push(`${key} = $${index + 1}`);
        params.push(value);
      });

      if (whereClauses.length > 0) {
        query += ` WHERE ${whereClauses.join(' AND ')}`;
      }

      const result = await this.db.query(query, params);
      return parseInt(result.rows[0].count);
    } catch (error) {
      logger.error(`Error counting ${this.tableName}`, { conditions, error: error.message });
      throw error;
    }
  }

  async exists(conditions) {
    try {
      const count = await this.count(conditions);
      return count > 0;
    } catch (error) {
      logger.error(`Error checking existence in ${this.tableName}`, { conditions, error: error.message });
      throw error;
    }
  }

  // Transaction helper
  async withTransaction(callback) {
    const client = await this.db.connect();
    
    try {
      await client.query('BEGIN');
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

module.exports = BaseRepository;