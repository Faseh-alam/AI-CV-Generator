const { getRedis } = require('../config/redis');
const logger = require('../utils/logger');

// Simple in-memory rate limiter for development
const memoryStore = new Map();

// Create rate limiter middleware
const createRateLimiter = (windowMs, max, message) => {
  return async (req, res, next) => {
    try {
      const key = `rate_limit:${req.ip}:${req.route?.path || req.path}`;
      const now = Date.now();
      const windowStart = now - windowMs;

      let requests;
      
      if (process.env.NODE_ENV === 'production' && process.env.REDIS_URL) {
        // Use Redis in production
        try {
          const redis = getRedis();
          const current = await redis.incr(key);
          
          if (current === 1) {
            await redis.expire(key, Math.ceil(windowMs / 1000));
          }
          
          requests = current;
        } catch (redisError) {
          logger.warn('Redis rate limiting failed, falling back to memory:', redisError);
          requests = getMemoryCount(key, windowStart, now);
        }
      } else {
        // Use memory store for development
        requests = getMemoryCount(key, windowStart, now);
      }

      if (requests > max) {
        return res.status(429).json({
          success: false,
          error: {
            code: 'RATE_LIMIT_EXCEEDED',
            message
          }
        });
      }

      // Add rate limit headers
      res.set({
        'X-RateLimit-Limit': max,
        'X-RateLimit-Remaining': Math.max(0, max - requests),
        'X-RateLimit-Reset': new Date(now + windowMs).toISOString()
      });

      next();
    } catch (error) {
      logger.error('Rate limiter error:', error);
      // Don't block requests if rate limiter fails
      next();
    }
  };
};

// Memory-based request counting
const getMemoryCount = (key, windowStart, now) => {
  if (!memoryStore.has(key)) {
    memoryStore.set(key, []);
  }
  
  const requests = memoryStore.get(key);
  
  // Remove old requests outside the window
  const validRequests = requests.filter(timestamp => timestamp > windowStart);
  
  // Add current request
  validRequests.push(now);
  
  // Update store
  memoryStore.set(key, validRequests);
  
  // Clean up old entries periodically
  if (Math.random() < 0.01) { // 1% chance
    cleanupMemoryStore(windowStart);
  }
  
  return validRequests.length;
};

// Clean up old entries from memory store
const cleanupMemoryStore = (cutoff) => {
  for (const [key, requests] of memoryStore.entries()) {
    const validRequests = requests.filter(timestamp => timestamp > cutoff);
    if (validRequests.length === 0) {
      memoryStore.delete(key);
    } else {
      memoryStore.set(key, validRequests);
    }
  }
};

// General API rate limiter
const generalLimiter = createRateLimiter(
  15 * 60 * 1000, // 15 minutes
  100, // limit each IP to 100 requests per windowMs
  'Too many requests from this IP, please try again later'
);

// Auth rate limiter (more restrictive)
const authLimiter = createRateLimiter(
  15 * 60 * 1000, // 15 minutes
  5, // limit each IP to 5 requests per windowMs
  'Too many authentication attempts, please try again later'
);

// File upload rate limiter
const uploadLimiter = createRateLimiter(
  60 * 60 * 1000, // 1 hour
  10, // limit each IP to 10 uploads per hour
  'Too many file uploads, please try again later'
);

// AI optimization rate limiter
const optimizationLimiter = createRateLimiter(
  60 * 60 * 1000, // 1 hour
  20, // limit each IP to 20 optimizations per hour
  'Too many optimization requests, please try again later'
);

module.exports = {
  generalLimiter,
  authLimiter,
  uploadLimiter,
  optimizationLimiter
};