const CircuitBreaker = require('opossum');
const logger = require('../utils/logger');

class ErrorHandlingService {
  constructor() {
    this.errorHandlers = new Map();
    this.recoveryStrategies = new Map();
    this.circuitBreakers = new Map();
    
    this.initializeHandlers();
    this.initializeRecoveryStrategies();
  }

  initializeHandlers() {
    // API errors
    this.registerHandler('API_ERROR', async (error, context) => {
      const { service, operation } = context;
      
      // Check circuit breaker
      const breaker = this.getCircuitBreaker(service);
      if (breaker.isOpen()) {
        return this.handleCircuitOpen(service, operation);
      }
      
      // Categorize API error
      if (error.response?.status === 429) {
        return this.handleRateLimit(error, context);
      } else if (error.response?.status >= 500) {
        return this.handleServerError(error, context);
      } else if (error.response?.status === 401) {
        return this.handleAuthError(error, context);
      }
      
      // Default API error handling
      return {
        retry: true,
        fallback: this.getFallbackStrategy(service, operation),
        userMessage: 'Service temporarily unavailable'
      };
    });
    
    // Database errors
    this.registerHandler('DATABASE_ERROR', async (error, context) => {
      const errorCode = error.code;
      
      switch (errorCode) {
        case 'ECONNREFUSED':
          return this.handleDatabaseConnectionError(error, context);
          
        case '23505': // Unique violation
          return {
            retry: false,
            userMessage: 'This item already exists',
            details: this.extractDuplicateKeyInfo(error)
          };
          
        case '57P03': // Cannot connect now
          return {
            retry: true,
            delay: 1000,
            maxAttempts: 3,
            userMessage: 'Database is busy, retrying...'
          };
          
        default:
          return this.handleGenericDatabaseError(error, context);
      }
    });
    
    // File processing errors
    this.registerHandler('FILE_ERROR', async (error, context) => {
      const { operation, fileType, fileSize } = context;
      
      if (error.code === 'FILE_TOO_LARGE') {
        return {
          retry: false,
          userMessage: `File size exceeds limit of ${this.formatBytes(10485760)}`,
          suggestion: 'Please upload a smaller file'
        };
      }
      
      if (error.code === 'INVALID_FILE_TYPE') {
        return {
          retry: false,
          userMessage: `File type '${fileType}' is not supported`,
          suggestion: `Supported types: PDF, DOCX, DOC, TXT`
        };
      }
      
      if (error.code === 'VIRUS_DETECTED') {
        // Security alert
        await this.logSecurityEvent('virus_detected', context);
        
        return {
          retry: false,
          userMessage: 'File failed security scan',
          alert: true
        };
      }
      
      // Attempt recovery
      return this.attemptFileRecovery(error, context);
    });

    // Validation errors
    this.registerHandler('VALIDATION_ERROR', async (error, context) => {
      return {
        retry: false,
        userMessage: 'Invalid input provided',
        details: error.details || [],
        statusCode: 400
      };
    });

    // JWT errors
    this.registerHandler('JWT_ERROR', async (error, context) => {
      if (error.name === 'TokenExpiredError') {
        return {
          retry: false,
          userMessage: 'Session expired, please login again',
          statusCode: 401,
          action: 'REDIRECT_LOGIN'
        };
      }
      
      if (error.name === 'JsonWebTokenError') {
        return {
          retry: false,
          userMessage: 'Invalid authentication token',
          statusCode: 401,
          action: 'REDIRECT_LOGIN'
        };
      }
      
      return {
        retry: false,
        userMessage: 'Authentication failed',
        statusCode: 401
      };
    });
  }

  initializeRecoveryStrategies() {
    // Claude API recovery
    this.registerRecovery('claude_api', {
      rateLimit: async (context) => {
        // Use cached responses if available
        const cached = await this.getCachedResponse(context);
        if (cached) return cached;
        
        // Queue for later processing
        await this.queueForRetry(context);
        
        return {
          status: 'queued',
          message: 'Your request has been queued and will be processed shortly'
        };
      },
      
      timeout: async (context) => {
        // Try simpler prompt
        const simplified = this.simplifyPrompt(context.prompt);
        return this.retryWithModification(context, { prompt: simplified });
      },
      
      serverError: async (context) => {
        // Fallback to local analysis
        return this.performLocalAnalysis(context);
      }
    });
    
    // Database recovery
    this.registerRecovery('database', {
      connectionLost: async (context) => {
        // Try replica if available
        if (this.hasReplica()) {
          return this.switchToReplica(context);
        }
        
        // Use cache
        return this.serveCachedData(context);
      },
      
      poolExhausted: async (context) => {
        // Queue query
        return this.queueDatabaseOperation(context);
      }
    });
  }

  registerHandler(errorType, handler) {
    this.errorHandlers.set(errorType, handler);
  }

  registerRecovery(service, strategies) {
    this.recoveryStrategies.set(service, strategies);
  }

  async handleError(error, context = {}) {
    const errorType = this.categorizeError(error);
    const handler = this.errorHandlers.get(errorType);
    
    if (!handler) {
      logger.error('Unhandled error type', {
        errorType,
        error: error.message,
        context
      });
      
      return this.defaultErrorResponse(error);
    }
    
    try {
      const result = await handler(error, context);
      
      // Log error with context
      this.logError(error, errorType, context, result);
      
      // Update metrics
      this.updateErrorMetrics(errorType, result);
      
      return result;
      
    } catch (handlerError) {
      logger.error('Error handler failed', {
        originalError: error.message,
        handlerError: handlerError.message
      });
      
      return this.defaultErrorResponse(error);
    }
  }

  categorizeError(error) {
    if (error.isAxiosError) return 'API_ERROR';
    if (error.code?.startsWith('2') || error.code?.startsWith('5')) return 'DATABASE_ERROR';
    if (error.code?.includes('FILE')) return 'FILE_ERROR';
    if (error.name === 'ValidationError') return 'VALIDATION_ERROR';
    if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') return 'JWT_ERROR';
    if (error.isOperational) return error.type || 'OPERATIONAL_ERROR';
    
    return 'UNKNOWN_ERROR';
  }

  getCircuitBreaker(service) {
    if (!this.circuitBreakers.has(service)) {
      this.circuitBreakers.set(service, new CircuitBreaker(async () => {}, {
        timeout: 30000,
        errorThresholdPercentage: 50,
        resetTimeout: 60000,
        name: service
      }));
    }
    
    return this.circuitBreakers.get(service);
  }

  async handleRateLimit(error, context) {
    const retryAfter = error.response?.headers['retry-after'];
    const delay = retryAfter ? parseInt(retryAfter) * 1000 : 60000;
    
    // Check if we can use cached data
    const cached = await this.checkCache(context);
    if (cached) {
      return {
        success: true,
        data: cached,
        source: 'cache',
        warning: 'Using cached data due to rate limit'
      };
    }
    
    // Queue for retry
    await this.queueWithDelay(context, delay);
    
    return {
      retry: true,
      delay,
      userMessage: 'Service is busy, your request will be processed soon',
      fallback: true
    };
  }

  async attemptFileRecovery(error, context) {
    const { filePath, operation } = context;
    
    const strategies = [
      {
        name: 'retry_with_smaller_chunk',
        applicable: () => operation === 'parse' && error.code === 'ENOMEM',
        execute: async () => {
          return this.parseFileInChunks(filePath, {
            chunkSize: 1024 * 1024 // 1MB chunks
          });
        }
      },
      {
        name: 'convert_and_retry',
        applicable: () => operation === 'parse' && error.code === 'INVALID_FORMAT',
        execute: async () => {
          const converted = await this.convertFile(filePath);
          return this.retryOperation(context, { filePath: converted });
        }
      },
      {
        name: 'repair_and_retry',
        applicable: () => error.code === 'CORRUPTED_FILE',
        execute: async () => {
          const repaired = await this.attemptFileRepair(filePath);
          return this.retryOperation(context, { filePath: repaired });
        }
      }
    ];
    
    for (const strategy of strategies) {
      if (strategy.applicable()) {
        try {
          logger.info(`Attempting recovery: ${strategy.name}`, context);
          return await strategy.execute();
        } catch (recoveryError) {
          logger.warn(`Recovery strategy failed: ${strategy.name}`, {
            error: recoveryError.message
          });
        }
      }
    }
    
    return {
      retry: false,
      userMessage: 'Unable to process file',
      suggestion: 'Please try uploading a different file'
    };
  }

  createErrorResponse(error, handled) {
    return {
      success: false,
      error: {
        message: handled.userMessage || 'An error occurred',
        code: error.code || 'UNKNOWN_ERROR',
        type: this.categorizeError(error),
        timestamp: new Date().toISOString(),
        requestId: error.requestId || require('uuid').v4()
      },
      retry: handled.retry || false,
      fallback: handled.fallback || null,
      suggestion: handled.suggestion || null
    };
  }

  // Express error middleware
  expressErrorHandler() {
    return async (err, req, res, next) => {
      const context = {
        url: req.url,
        method: req.method,
        ip: req.ip,
        userId: req.user?.id,
        requestId: req.id || require('uuid').v4()
      };
      
      const handled = await this.handleError(err, context);
      const response = this.createErrorResponse(err, handled);
      
      // Set appropriate status code
      const statusCode = this.getStatusCode(err, handled);
      
      res.status(statusCode).json(response);
    };
  }

  getStatusCode(error, handled) {
    if (handled.statusCode) return handled.statusCode;
    if (error.statusCode) return error.statusCode;
    if (error.response?.status) return error.response.status;
    
    const statusMap = {
      'VALIDATION_ERROR': 400,
      'JWT_ERROR': 401,
      'FORBIDDEN': 403,
      'NOT_FOUND': 404,
      'RATE_LIMITED': 429,
      'FILE_TOO_LARGE': 413
    };
    
    return statusMap[error.code] || 500;
  }

  logError(error, errorType, context, result) {
    logger.error('Error handled', {
      errorType,
      message: error.message,
      context,
      result: {
        retry: result.retry,
        userMessage: result.userMessage
      }
    });
  }

  updateErrorMetrics(errorType, result) {
    // Update error metrics - implement based on your metrics system
  }

  defaultErrorResponse(error) {
    return {
      retry: false,
      userMessage: 'An unexpected error occurred',
      statusCode: 500
    };
  }

  // Helper methods (implement based on your specific needs)
  async getCachedResponse(context) { return null; }
  async queueForRetry(context) { }
  async checkCache(context) { return null; }
  async queueWithDelay(context, delay) { }
  async logSecurityEvent(event, context) { }
  formatBytes(bytes) { return `${Math.round(bytes / 1024 / 1024)}MB`; }
  async parseFileInChunks(filePath, options) { }
  async convertFile(filePath) { }
  async retryOperation(context, modifications) { }
  async attemptFileRepair(filePath) { }
  simplifyPrompt(prompt) { return prompt; }
  async retryWithModification(context, modifications) { }
  async performLocalAnalysis(context) { }
  hasReplica() { return false; }
  async switchToReplica(context) { }
  async serveCachedData(context) { }
  async queueDatabaseOperation(context) { }
  handleCircuitOpen(service, operation) {
    return {
      retry: false,
      userMessage: `${service} service is temporarily unavailable`,
      fallback: true
    };
  }
  getFallbackStrategy(service, operation) { return null; }
  handleDatabaseConnectionError(error, context) {
    return {
      retry: true,
      delay: 5000,
      maxAttempts: 3,
      userMessage: 'Database connection issue, retrying...'
    };
  }
  extractDuplicateKeyInfo(error) {
    return { field: 'unknown' };
  }
  handleGenericDatabaseError(error, context) {
    return {
      retry: false,
      userMessage: 'Database error occurred',
      statusCode: 500
    };
  }
  handleServerError(error, context) {
    return {
      retry: true,
      delay: 2000,
      maxAttempts: 2,
      userMessage: 'Server error, retrying...'
    };
  }
  handleAuthError(error, context) {
    return {
      retry: false,
      userMessage: 'Authentication failed',
      statusCode: 401
    };
  }
}

module.exports = ErrorHandlingService;