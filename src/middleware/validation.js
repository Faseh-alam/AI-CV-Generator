const Joi = require('joi');
const DOMPurify = require('isomorphic-dompurify');
const logger = require('../utils/logger');

// Custom validation rules
const customJoi = Joi.extend((joi) => ({
  type: 'string',
  base: joi.string(),
  messages: {
    'string.noHtml': '{{#label}} must not contain HTML tags',
    'string.noSql': '{{#label}} contains potentially dangerous characters'
  },
  rules: {
    noHtml: {
      validate(value, helpers) {
        if (/<[^>]*>/g.test(value)) {
          return helpers.error('string.noHtml');
        }
        return value;
      }
    },
    noSql: {
      validate(value, helpers) {
        const sqlPatterns = [
          /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|EXEC|UNION|SCRIPT)\b)/i,
          /(--|\/\*|\*\/|;|'|"|`)/,
          /(\bOR\b|\bAND\b).*[=<>]/i
        ];
        
        if (sqlPatterns.some(pattern => pattern.test(value))) {
          return helpers.error('string.noSql');
        }
        return value;
      }
    }
  }
}));

// Schema definitions with enhanced security
const schemas = {
  register: customJoi.object({
    email: customJoi.string()
      .email({ tlds: { allow: false } })
      .max(255)
      .required()
      .messages({
        'string.email': 'Please provide a valid email address',
        'string.max': 'Email cannot exceed 255 characters'
      }),
    
    password: customJoi.string()
      .min(8)
      .max(128)
      .pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
      .required()
      .messages({
        'string.min': 'Password must be at least 8 characters long',
        'string.max': 'Password cannot exceed 128 characters',
        'string.pattern.base': 'Password must contain at least one lowercase letter, one uppercase letter, one number, and one special character'
      }),
    
    firstName: customJoi.string()
      .min(2)
      .max(50)
      .pattern(/^[a-zA-Z\s'-]+$/)
      .noHtml()
      .required()
      .messages({
        'string.pattern.base': 'First name can only contain letters, spaces, hyphens, and apostrophes'
      }),
    
    lastName: customJoi.string()
      .min(2)
      .max(50)
      .pattern(/^[a-zA-Z\s'-]+$/)
      .noHtml()
      .required()
      .messages({
        'string.pattern.base': 'Last name can only contain letters, spaces, hyphens, and apostrophes'
      })
  }),

  login: customJoi.object({
    email: customJoi.string()
      .email({ tlds: { allow: false } })
      .max(255)
      .required(),
    
    password: customJoi.string()
      .min(1)
      .max(128)
      .required()
  }),

  jobDescription: customJoi.object({
    title: customJoi.string()
      .min(3)
      .max(200)
      .noHtml()
      .noSql()
      .required()
      .messages({
        'string.min': 'Job title must be at least 3 characters long',
        'string.max': 'Job title cannot exceed 200 characters'
      }),
    
    company: customJoi.string()
      .min(2)
      .max(100)
      .noHtml()
      .noSql()
      .required()
      .messages({
        'string.min': 'Company name must be at least 2 characters long',
        'string.max': 'Company name cannot exceed 100 characters'
      }),
    
    description: customJoi.string()
      .min(50)
      .max(10000)
      .noSql()
      .required()
      .messages({
        'string.min': 'Job description must be at least 50 characters long',
        'string.max': 'Job description cannot exceed 10,000 characters'
      }),
    
    requirements: customJoi.string()
      .max(5000)
      .noSql()
      .optional()
      .messages({
        'string.max': 'Requirements cannot exceed 5,000 characters'
      }),
    
    location: customJoi.string()
      .max(100)
      .noHtml()
      .noSql()
      .optional(),
    
    salaryRange: customJoi.object({
      min: customJoi.number().positive().max(10000000).optional(),
      max: customJoi.number().positive().max(10000000).greater(customJoi.ref('min')).optional(),
      currency: customJoi.string().valid('USD', 'EUR', 'GBP', 'CAD', 'AUD').default('USD')
    }).optional(),
    
    industry: customJoi.string()
      .max(50)
      .noHtml()
      .noSql()
      .optional(),
    
    jobLevel: customJoi.string()
      .valid('entry', 'mid', 'senior', 'executive')
      .optional(),
    
    workArrangement: customJoi.string()
      .valid('remote', 'hybrid', 'onsite')
      .optional(),
    
    url: customJoi.string()
      .uri({ scheme: ['http', 'https'] })
      .max(500)
      .optional()
  }),

  optimization: customJoi.object({
    resumeId: customJoi.string()
      .uuid({ version: 'uuidv4' })
      .required()
      .messages({
        'string.uuid': 'Invalid resume ID format'
      }),
    
    jobDescriptionId: customJoi.string()
      .uuid({ version: 'uuidv4' })
      .required()
      .messages({
        'string.uuid': 'Invalid job description ID format'
      }),
    
    optimizationLevel: customJoi.string()
      .valid('minimal', 'balanced', 'aggressive')
      .default('balanced')
      .messages({
        'any.only': 'Optimization level must be minimal, balanced, or aggressive'
      }),
    
    targetKeywords: customJoi.array()
      .items(customJoi.string().max(100).noHtml().noSql())
      .max(50)
      .optional()
      .messages({
        'array.max': 'Cannot specify more than 50 target keywords'
      })
  }),

  resumeUpload: customJoi.object({
    name: customJoi.string()
      .min(1)
      .max(255)
      .noHtml()
      .noSql()
      .required()
      .messages({
        'string.min': 'Resume name is required',
        'string.max': 'Resume name cannot exceed 255 characters'
      }),
    
    isDefault: customJoi.boolean().default(false)
  }),

  application: customJoi.object({
    companyName: customJoi.string()
      .min(1)
      .max(255)
      .noHtml()
      .noSql()
      .required(),
    
    jobTitle: customJoi.string()
      .min(1)
      .max(255)
      .noHtml()
      .noSql()
      .required(),
    
    applicationDate: customJoi.date()
      .max('now')
      .required()
      .messages({
        'date.max': 'Application date cannot be in the future'
      }),
    
    status: customJoi.string()
      .valid('applied', 'reviewed', 'interview', 'rejected', 'offer', 'accepted')
      .default('applied'),
    
    responseDate: customJoi.date()
      .min(customJoi.ref('applicationDate'))
      .optional()
      .messages({
        'date.min': 'Response date cannot be before application date'
      }),
    
    interviewDate: customJoi.date()
      .min(customJoi.ref('applicationDate'))
      .optional()
      .messages({
        'date.min': 'Interview date cannot be before application date'
      }),
    
    notes: customJoi.string()
      .max(1000)
      .noSql()
      .optional(),
    
    optimizationId: customJoi.string()
      .uuid({ version: 'uuidv4' })
      .optional(),
    
    salaryOffered: customJoi.number()
      .positive()
      .max(10000000)
      .optional()
  }),

  userProfile: customJoi.object({
    firstName: customJoi.string()
      .min(2)
      .max(50)
      .pattern(/^[a-zA-Z\s'-]+$/)
      .noHtml()
      .optional(),
    
    lastName: customJoi.string()
      .min(2)
      .max(50)
      .pattern(/^[a-zA-Z\s'-]+$/)
      .noHtml()
      .optional(),
    
    email: customJoi.string()
      .email({ tlds: { allow: false } })
      .max(255)
      .optional(),
    
    preferences: customJoi.object({
      defaultOptimizationLevel: customJoi.string()
        .valid('minimal', 'balanced', 'aggressive')
        .optional(),
      
      emailNotifications: customJoi.boolean().optional(),
      
      autoSaveInterval: customJoi.number()
        .min(10)
        .max(300)
        .optional()
    }).optional()
  })
};

// Validation middleware factory
const validate = (schemaName) => {
  return async (req, res, next) => {
    try {
      const schema = schemas[schemaName];
      if (!schema) {
        logger.error('Validation schema not found', { schemaName });
        return res.status(500).json({
          success: false,
          error: {
            code: 'VALIDATION_CONFIG_ERROR',
            message: 'Validation configuration error'
          }
        });
      }

      // Validate and sanitize
      const validated = await schema.validateAsync(req.body, {
        abortEarly: false,
        stripUnknown: true,
        convert: true
      });

      // Additional sanitization
      req.body = sanitizeObject(validated);
      
      // Log validation success for security monitoring
      logger.info('Input validation passed', {
        schema: schemaName,
        userId: req.user?.id,
        ip: req.ip
      });

      next();
    } catch (error) {
      if (error.isJoi) {
        logger.warn('Input validation failed', {
          schema: schemaName,
          errors: error.details.map(d => ({
            field: d.path.join('.'),
            message: d.message
          })),
          userId: req.user?.id,
          ip: req.ip
        });

        return res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Input validation failed',
            details: error.details.map(d => ({
              field: d.path.join('.'),
              message: d.message
            }))
          }
        });
      }

      logger.error('Validation middleware error', {
        schema: schemaName,
        error: error.message,
        userId: req.user?.id
      });

      next(error);
    }
  };
};

// Recursive sanitization function
function sanitizeObject(obj) {
  if (typeof obj === 'string') {
    // Remove HTML tags and dangerous characters
    let sanitized = DOMPurify.sanitize(obj, {
      ALLOWED_TAGS: [],
      ALLOWED_ATTR: []
    });
    
    // Additional sanitization for common attack vectors
    sanitized = sanitized
      .replace(/javascript:/gi, '')
      .replace(/vbscript:/gi, '')
      .replace(/onload/gi, '')
      .replace(/onerror/gi, '')
      .replace(/onclick/gi, '')
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
    
    return sanitized.trim();
  } else if (Array.isArray(obj)) {
    return obj.map(sanitizeObject);
  } else if (obj !== null && typeof obj === 'object') {
    const sanitized = {};
    for (const [key, value] of Object.entries(obj)) {
      // Sanitize keys as well
      const sanitizedKey = key.replace(/[^a-zA-Z0-9_]/g, '');
      if (sanitizedKey) {
        sanitized[sanitizedKey] = sanitizeObject(value);
      }
    }
    return sanitized;
  }
  return obj;
}

// File upload validation
const validateFileUpload = (allowedTypes = [], maxSize = 5 * 1024 * 1024) => {
  return (req, res, next) => {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'NO_FILE',
          message: 'No file uploaded'
        }
      });
    }

    const file = req.file;

    // Check file size
    if (file.size > maxSize) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'FILE_TOO_LARGE',
          message: `File size cannot exceed ${Math.round(maxSize / 1024 / 1024)}MB`
        }
      });
    }

    // Check file type
    if (allowedTypes.length > 0 && !allowedTypes.includes(file.mimetype)) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_FILE_TYPE',
          message: `File type not allowed. Allowed types: ${allowedTypes.join(', ')}`
        }
      });
    }

    // Check for malicious file names
    const dangerousPatterns = [
      /\.\./,  // Directory traversal
      /[<>:"|?*]/,  // Invalid filename characters
      /\.(exe|bat|cmd|scr|pif|com)$/i  // Executable files
    ];

    if (dangerousPatterns.some(pattern => pattern.test(file.originalname))) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'DANGEROUS_FILENAME',
          message: 'Filename contains dangerous characters or patterns'
        }
      });
    }

    logger.info('File upload validation passed', {
      filename: file.originalname,
      mimetype: file.mimetype,
      size: file.size,
      userId: req.user?.id
    });

    next();
  };
};

// Rate limiting validation helper
const validateRateLimit = (identifier, limit, window) => {
  return async (req, res, next) => {
    try {
      const key = `rate_limit:${identifier}:${req.ip}`;
      // Rate limiting logic would go here
      next();
    } catch (error) {
      logger.error('Rate limit validation error', { error: error.message });
      next(error);
    }
  };
};

module.exports = {
  validate,
  validateFileUpload,
  validateRateLimit,
  sanitizeObject,
  schemas
};