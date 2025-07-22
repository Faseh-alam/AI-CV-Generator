const redis = require('redis');
const logger = require('../utils/logger');

let client;

const connectRedis = async () => {
  try {
    client = redis.createClient({
      url: process.env.REDIS_URL || 'redis://localhost:6379'
    });

    client.on('error', (err) => {
      logger.error('Redis Client Error:', err);
    });

    client.on('connect', () => {
      logger.info('Redis connected successfully');
    });

    await client.connect();
    return client;
  } catch (error) {
    logger.error('Redis connection failed:', error);
    throw error;
  }
};

const getRedis = () => {
  if (!client) {
    throw new Error('Redis not initialized. Call connectRedis first.');
  }
  return client;
};

const closeRedis = async () => {
  if (client) {
    await client.quit();
    logger.info('Redis connection closed');
  }
};

module.exports = {
  connectRedis,
  getRedis,
  closeRedis
};