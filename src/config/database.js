const { Pool } = require('pg');
const logger = require('../utils/logger');

let pool;

const connectDB = async () => {
  try {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });

    // Test the connection
    const client = await pool.connect();
    await client.query('SELECT NOW()');
    client.release();
    
    logger.info('PostgreSQL connected successfully');
    return pool;
  } catch (error) {
    logger.error('PostgreSQL connection failed:', error);
    throw error;
  }
};

const getDB = () => {
  if (!pool) {
    throw new Error('Database not initialized. Call connectDB first.');
  }
  return pool;
};

const closeDB = async () => {
  if (pool) {
    await pool.end();
    logger.info('PostgreSQL connection closed');
  }
};

module.exports = {
  connectDB,
  getDB,
  closeDB
};