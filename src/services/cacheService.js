const { getRedis } = require('../config/redis');
const crypto = require('crypto');
const logger = require('../utils/logger');

class CacheService {
  constructor() {
    this.redis = getRedis();
    this.defaultTTL = 3600; // 1 hour
    this.keyPrefix = 'resume_optimizer:';
    
    // TTL strategies based on data type and access patterns
    this.ttlStrategies = {
      userProfile: 3600,        // 1 hour - frequently accessed
      resumeAnalysis: 7200,     // 2 hours - expensive to compute
      jobKeywords: 86400,       // 24 hours - relatively stable
      matchScore: 1800,         // 30 minutes - depends on optimization
      searchResults: 300,       // 5 minutes - frequently changing
      optimizationResult: 14400, // 4 hours - expensive to compute
      fileMetadata: 43200,      // 12 hours - rarely changes
      userStats: 900,           // 15 minutes - frequently updated
      popularKeywords: 21600    // 6 hours - changes slowly
    };

    // Cache warming configuration
    this.warmingConfig = {
      enabled: process.env.CACHE_WARMING_ENABLED === 'true',
      interval: 300000, // 5 minutes
      batchSize: 10
    };

    this.stats = {
      hits: 0,
      misses: 0,
      sets: 0,
      deletes: 0,
      errors: 0
    };

    this.initializeWarming();
  }

  generateKey(namespace, ...params) {
    // Create deterministic key from parameters
    const keyData = params.map(p => 
      typeof p === 'object' ? JSON.stringify(p) : String(p)
    ).join(':');
    
    const hash = crypto
      .createHash('md5')
      .update(keyData)
      .digest('hex');
    
    return `${this.keyPrefix}${namespace}:${hash}`;
  }

  async get(key, options = {}) {
    try {
      const fullKey = key.startsWith(this.keyPrefix) ? key : `${this.keyPrefix}${key}`;
      const data = await this.redis.get(fullKey);
      
      if (!data) {
        this.stats.misses++;
        return null;
      }

      const parsed = JSON.parse(data);
      
      // Check if cache is stale (if timestamp provided)
      if (options.maxAge && parsed.timestamp) {
        const age = Date.now() - parsed.timestamp;
        if (age > options.maxAge * 1000) {
          await this.redis.del(fullKey);
          this.stats.misses++;
          return null;
        }
      }

      // Check if cache should be refreshed in background
      if (options.refreshThreshold && parsed.timestamp) {
        const age = Date.now() - parsed.timestamp;
        const ttl = await this.redis.ttl(fullKey);
        
        if (ttl > 0 && age > options.refreshThreshold * 1000) {
          // Trigger background refresh if callback provided
          if (options.refreshCallback) {
            setImmediate(() => {
              options.refreshCallback().then(newData => {
                this.set(key, newData, options);
              }).catch(error => {
                logger.error('Background cache refresh failed', { key, error: error.message });
              });
            });
          }
        }
      }

      this.stats.hits++;
      return parsed.data;
    } catch (error) {
      this.stats.errors++;
      logger.error('Cache get error', { key, error: error.message });
      return null; // Fail gracefully
    }
  }

  async set(key, data, options = {}) {
    try {
      const fullKey = key.startsWith(this.keyPrefix) ? key : `${this.keyPrefix}${key}`;
      const ttl = options.ttl || this.defaultTTL;
      
      const value = JSON.stringify({
        data,
        timestamp: Date.now(),
        version: options.version || 1,
        metadata: options.metadata || {}
      });

      if (ttl > 0) {
        await this.redis.setex(fullKey, ttl, value);
      } else {
        await this.redis.set(fullKey, value);
      }

      this.stats.sets++;
      return true;
    } catch (error) {
      this.stats.errors++;
      logger.error('Cache set error', { key, error: error.message });
      return false;
    }
  }

  async getOrSet(key, factory, options = {}) {
    let data = await this.get(key, options);
    
    if (data === null) {
      try {
        data = await factory();
        await this.set(key, data, options);
      } catch (error) {
        logger.error('Cache factory function failed', { key, error: error.message });
        throw error;
      }
    }

    return data;
  }

  async mget(keys) {
    try {
      const fullKeys = keys.map(key => 
        key.startsWith(this.keyPrefix) ? key : `${this.keyPrefix}${key}`
      );
      
      const values = await this.redis.mget(...fullKeys);
      const results = {};
      
      keys.forEach((key, index) => {
        if (values[index]) {
          try {
            const parsed = JSON.parse(values[index]);
            results[key] = parsed.data;
            this.stats.hits++;
          } catch (error) {
            logger.error('Cache parse error in mget', { key, error: error.message });
            results[key] = null;
            this.stats.errors++;
          }
        } else {
          results[key] = null;
          this.stats.misses++;
        }
      });
      
      return results;
    } catch (error) {
      this.stats.errors++;
      logger.error('Cache mget error', { keys, error: error.message });
      return {};
    }
  }

  async mset(keyValuePairs, options = {}) {
    try {
      const pipeline = this.redis.pipeline();
      const ttl = options.ttl || this.defaultTTL;
      
      for (const [key, data] of Object.entries(keyValuePairs)) {
        const fullKey = key.startsWith(this.keyPrefix) ? key : `${this.keyPrefix}${key}`;
        const value = JSON.stringify({
          data,
          timestamp: Date.now(),
          version: options.version || 1,
          metadata: options.metadata || {}
        });
        
        if (ttl > 0) {
          pipeline.setex(fullKey, ttl, value);
        } else {
          pipeline.set(fullKey, value);
        }
      }
      
      await pipeline.exec();
      this.stats.sets += Object.keys(keyValuePairs).length;
      return true;
    } catch (error) {
      this.stats.errors++;
      logger.error('Cache mset error', { error: error.message });
      return false;
    }
  }

  async invalidate(key) {
    try {
      const fullKey = key.startsWith(this.keyPrefix) ? key : `${this.keyPrefix}${key}`;
      const result = await this.redis.del(fullKey);
      
      if (result > 0) {
        this.stats.deletes++;
      }
      
      return result > 0;
    } catch (error) {
      this.stats.errors++;
      logger.error('Cache invalidate error', { key, error: error.message });
      return false;
    }
  }

  async invalidatePattern(pattern) {
    try {
      const fullPattern = pattern.startsWith(this.keyPrefix) 
        ? pattern 
        : `${this.keyPrefix}${pattern}`;
      
      const keys = await this.redis.keys(fullPattern);
      
      if (keys.length > 0) {
        const deleted = await this.redis.del(...keys);
        this.stats.deletes += deleted;
        
        logger.info('Cache pattern invalidated', { 
          pattern: fullPattern, 
          keysDeleted: deleted 
        });
        
        return deleted;
      }
      
      return 0;
    } catch (error) {
      this.stats.errors++;
      logger.error('Cache pattern invalidation error', { pattern, error: error.message });
      return 0;
    }
  }

  async invalidateUser(userId) {
    const patterns = [
      `userProfile:*${userId}*`,
      `resumeAnalysis:*${userId}*`,
      `matchScore:*${userId}*`,
      `searchResults:*${userId}*`,
      `userStats:*${userId}*`
    ];

    let totalDeleted = 0;
    for (const pattern of patterns) {
      totalDeleted += await this.invalidatePattern(pattern);
    }

    logger.info('User cache invalidated', { userId, keysDeleted: totalDeleted });
    return totalDeleted;
  }

  // Cache-aside pattern with automatic invalidation
  async getWithTags(key, tags = []) {
    const data = await this.get(key);
    
    if (data && tags.length > 0) {
      // Store tag associations for later invalidation
      const pipeline = this.redis.pipeline();
      
      for (const tag of tags) {
        const tagKey = `${this.keyPrefix}tag:${tag}`;
        pipeline.sadd(tagKey, key);
        pipeline.expire(tagKey, 86400); // 24 hours
      }
      
      await pipeline.exec();
    }
    
    return data;
  }

  async invalidateByTag(tag) {
    try {
      const tagKey = `${this.keyPrefix}tag:${tag}`;
      const keys = await this.redis.smembers(tagKey);
      
      if (keys.length > 0) {
        const pipeline = this.redis.pipeline();
        
        // Delete all keys with this tag
        for (const key of keys) {
          pipeline.del(key);
        }
        
        // Delete the tag set itself
        pipeline.del(tagKey);
        
        const results = await pipeline.exec();
        const deleted = results.filter(([err, result]) => !err && result > 0).length;
        
        this.stats.deletes += deleted;
        
        logger.info('Cache invalidated by tag', { tag, keysDeleted: deleted });
        return deleted;
      }
      
      return 0;
    } catch (error) {
      this.stats.errors++;
      logger.error('Cache tag invalidation error', { tag, error: error.message });
      return 0;
    }
  }

  // Cache warming functionality
  initializeWarming() {
    if (!this.warmingConfig.enabled) {
      return;
    }

    setInterval(() => {
      this.performCacheWarming().catch(error => {
        logger.error('Cache warming failed', { error: error.message });
      });
    }, this.warmingConfig.interval);

    logger.info('Cache warming initialized', this.warmingConfig);
  }

  async performCacheWarming() {
    try {
      // Get list of active users for warming
      const activeUsers = await this.getActiveUsers();
      
      for (let i = 0; i < activeUsers.length; i += this.warmingConfig.batchSize) {
        const batch = activeUsers.slice(i, i + this.warmingConfig.batchSize);
        
        await Promise.all(batch.map(userId => this.warmUserCache(userId)));
        
        // Small delay between batches to avoid overwhelming the system
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
      logger.info('Cache warming completed', { 
        usersWarmed: activeUsers.length 
      });
    } catch (error) {
      logger.error('Cache warming error', { error: error.message });
    }
  }

  async getActiveUsers() {
    // This would typically query the database for recently active users
    // For now, return empty array - implement based on your user activity tracking
    return [];
  }

  async warmUserCache(userId) {
    try {
      const warmingTasks = [
        this.warmUserProfile(userId),
        this.warmRecentOptimizations(userId),
        this.warmUserStats(userId)
      ];

      await Promise.all(warmingTasks);
    } catch (error) {
      logger.error('User cache warming failed', { userId, error: error.message });
    }
  }

  async warmUserProfile(userId) {
    const key = this.generateKey('userProfile', userId);
    
    // Check if already cached
    const cached = await this.get(key);
    if (cached) return;

    // This would fetch from database - implement based on your user repository
    // const userData = await userRepository.findById(userId);
    // await this.set(key, userData, { ttl: this.ttlStrategies.userProfile });
  }

  async warmRecentOptimizations(userId) {
    const key = this.generateKey('recentOptimizations', userId);
    
    const cached = await this.get(key);
    if (cached) return;

    // This would fetch recent optimizations - implement based on your optimization repository
    // const optimizations = await optimizationRepository.findRecentByUser(userId, 10);
    // await this.set(key, optimizations, { ttl: this.ttlStrategies.optimizationResult });
  }

  async warmUserStats(userId) {
    const key = this.generateKey('userStats', userId);
    
    const cached = await this.get(key);
    if (cached) return;

    // This would calculate user statistics - implement based on your analytics service
    // const stats = await analyticsService.getUserStats(userId);
    // await this.set(key, stats, { ttl: this.ttlStrategies.userStats });
  }

  // Metrics and monitoring
  getStats() {
    const hitRate = this.stats.hits + this.stats.misses > 0 
      ? (this.stats.hits / (this.stats.hits + this.stats.misses) * 100).toFixed(2)
      : 0;

    return {
      ...this.stats,
      hitRate: `${hitRate}%`,
      totalOperations: this.stats.hits + this.stats.misses + this.stats.sets + this.stats.deletes
    };
  }

  resetStats() {
    this.stats = {
      hits: 0,
      misses: 0,
      sets: 0,
      deletes: 0,
      errors: 0
    };
  }

  async getMemoryUsage() {
    try {
      const info = await this.redis.info('memory');
      const lines = info.split('\r\n');
      const memoryInfo = {};
      
      lines.forEach(line => {
        if (line.includes(':')) {
          const [key, value] = line.split(':');
          if (key.startsWith('used_memory')) {
            memoryInfo[key] = value;
          }
        }
      });
      
      return memoryInfo;
    } catch (error) {
      logger.error('Failed to get cache memory usage', { error: error.message });
      return {};
    }
  }

  async healthCheck() {
    try {
      const start = Date.now();
      await this.redis.ping();
      const latency = Date.now() - start;
      
      const memoryUsage = await this.getMemoryUsage();
      const stats = this.getStats();
      
      return {
        status: 'healthy',
        latency,
        memoryUsage,
        stats,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }
}

module.exports = CacheService;