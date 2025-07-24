const winston = require('winston');
const { ElasticsearchTransport } = require('winston-elasticsearch');
const cls = require('cls-hooked');
const os = require('os');
const { v4: uuid } = require('uuid');

class EnhancedLogger {
  constructor() {
    this.namespace = cls.createNamespace('logging');
    this.logger = this.createLogger();
    this.metrics = new Map();
  }

  createLogger() {
    const transports = [];
    
    // Console transport with pretty printing for development
    if (process.env.NODE_ENV !== 'production') {
      transports.push(new winston.transports.Console({
        format: winston.format.combine(
          winston.format.colorize(),
          winston.format.timestamp(),
          winston.format.printf(this.devFormat)
        )
      }));
    }
    
    // File transports
    transports.push(
      new winston.transports.File({ 
        filename: 'logs/error.log', 
        level: 'error',
        maxsize: 10485760, // 10MB
        maxFiles: 5
      }),
      new winston.transports.File({ 
        filename: 'logs/combined.log',
        maxsize: 10485760, // 10MB
        maxFiles: 5
      })
    );
    
    // Production transports
    if (process.env.NODE_ENV === 'production' && process.env.ELASTICSEARCH_URL) {
      transports.push(new ElasticsearchTransport({
        level: 'info',
        clientOpts: {
          node: process.env.ELASTICSEARCH_URL,
          auth: {
            username: process.env.ELASTICSEARCH_USER,
            password: process.env.ELASTICSEARCH_PASS
          }
        },
        index: 'app-logs',
        dataStream: true,
        source: 'resume-optimizer',
        transformer: this.elasticsearchTransformer.bind(this)
      }));
    }
    
    return winston.createLogger({
      level: process.env.LOG_LEVEL || 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json()
      ),
      transports,
      exitOnError: false
    });
  }

  devFormat(info) {
    const { timestamp, level, message, ...meta } = info;
    const metaStr = Object.keys(meta).length ? 
      '\n' + JSON.stringify(meta, null, 2) : '';
    
    return `${timestamp} [${level}] ${message}${metaStr}`;
  }

  elasticsearchTransformer(logData) {
    const transformed = {
      '@timestamp': logData.timestamp || new Date().toISOString(),
      severity: logData.level,
      message: logData.message,
      service: 'resume-optimizer',
      environment: process.env.NODE_ENV,
      ...this.getContext(),
      ...logData.meta
    };
    
    // Add performance metrics if available
    const traceId = this.getTraceId();
    if (this.metrics.has(traceId)) {
      transformed.performance = this.metrics.get(traceId);
    }
    
    return transformed;
  }

  getContext() {
    return {
      traceId: this.namespace.get('traceId'),
      userId: this.namespace.get('userId'),
      requestId: this.namespace.get('requestId'),
      sessionId: this.namespace.get('sessionId'),
      ip: this.namespace.get('ip'),
      userAgent: this.namespace.get('userAgent')
    };
  }

  getTraceId() {
    return this.namespace.get('traceId') || 'no-trace';
  }

  // Enhanced logging methods
  info(message, meta = {}) {
    this.logger.info(message, this.enhanceMeta(meta));
  }

  warn(message, meta = {}) {
    this.logger.warn(message, this.enhanceMeta(meta));
  }

  error(message, error, meta = {}) {
    const errorMeta = {
      error: {
        message: error?.message || error,
        stack: error?.stack,
        code: error?.code,
        type: error?.constructor?.name
      },
      ...meta
    };
    
    this.logger.error(message, this.enhanceMeta(errorMeta));
  }

  // Performance logging
  startTimer(operation) {
    const traceId = this.getTraceId();
    const timerId = `${traceId}:${operation}`;
    
    if (!this.metrics.has(traceId)) {
      this.metrics.set(traceId, {});
    }
    
    this.metrics.get(traceId)[operation] = {
      start: Date.now()
    };
    
    return timerId;
  }

  endTimer(timerId, metadata = {}) {
    const [traceId, operation] = timerId.split(':');
    const metrics = this.metrics.get(traceId);
    
    if (metrics && metrics[operation]) {
      const duration = Date.now() - metrics[operation].start;
      metrics[operation] = {
        duration,
        ...metadata
      };
      
      this.info(`Operation completed: ${operation}`, {
        performance: {
          operation,
          duration,
          ...metadata
        }
      });
    }
  }

  // Audit logging
  audit(action, details) {
    this.logger.info('AUDIT', {
      ...this.enhanceMeta({
        audit: true,
        action,
        details,
        timestamp: new Date().toISOString()
      })
    });
  }

  // Security logging
  security(event, details) {
    this.logger.warn('SECURITY', {
      ...this.enhanceMeta({
        security: true,
        event,
        details,
        timestamp: new Date().toISOString()
      })
    });
  }

  enhanceMeta(meta) {
    return {
      ...this.getContext(),
      ...meta,
      hostname: os.hostname(),
      pid: process.pid
    };
  }

  // Express middleware
  middleware() {
    return (req, res, next) => {
      this.namespace.run(() => {
        // Set context
        const traceId = req.headers['x-trace-id'] || uuid();
        this.namespace.set('traceId', traceId);
        this.namespace.set('requestId', req.id || uuid());
        this.namespace.set('userId', req.user?.id);
        this.namespace.set('ip', req.ip);
        this.namespace.set('userAgent', req.get('user-agent'));
        
        // Log request
        const timer = this.startTimer('request');
        
        this.info('Request received', {
          method: req.method,
          url: req.url,
          query: req.query,
          headers: this.sanitizeHeaders(req.headers)
        });
        
        // Intercept response
        const originalSend = res.send;
        res.send = (data) => {
          res.send = originalSend;
          
          // Log response
          this.endTimer(timer, {
            statusCode: res.statusCode,
            contentLength: res.get('content-length')
          });
          
          this.info('Request completed', {
            statusCode: res.statusCode,
            duration: Date.now() - req.startTime
          });
          
          // Cleanup metrics
          setTimeout(() => {
            this.metrics.delete(traceId);
          }, 60000); // Clean after 1 minute
          
          return res.send(data);
        };
        
        req.startTime = Date.now();
        next();
      });
    };
  }

  sanitizeHeaders(headers) {
    const sensitive = ['authorization', 'cookie', 'x-api-key'];
    const sanitized = { ...headers };
    
    sensitive.forEach(key => {
      if (sanitized[key]) {
        sanitized[key] = '[REDACTED]';
      }
    });
    
    return sanitized;
  }
}

// Singleton instance
const enhancedLogger = new EnhancedLogger();

// Helper functions for backward compatibility
module.exports = {
  info: (message, meta) => enhancedLogger.info(message, meta),
  warn: (message, meta) => enhancedLogger.warn(message, meta),
  error: (message, error, meta) => enhancedLogger.error(message, error, meta),
  audit: (action, details) => enhancedLogger.audit(action, details),
  security: (event, details) => enhancedLogger.security(event, details),
  middleware: () => enhancedLogger.middleware(),
  startTimer: (operation) => enhancedLogger.startTimer(operation),
  endTimer: (timerId, metadata) => enhancedLogger.endTimer(timerId, metadata)
};