const Joi = require('joi');
const DOMPurify = require('isomorphic-dompurify');
const { RateLimiterMemory } = require('rate-limiter-flexible');

class SecureValidationService {
  constructor() {
    this.validators = new Map();
    this.rateLimiter = new RateLimiterMemory({
      points: 100, // Number of validation attempts
      duration: 60, // Per minute
      blockDuration: 60 // Block for 1 minute
    });
    
    this.initializeValidators();
  }

  initializeValidators() {
    // Safe integer validation
    const safeInteger = () => Joi.number()
      .integer()
      .min(-Number.MAX_SAFE_INTEGER)
      .max(Number.MAX_SAFE_INTEGER);
    
    // Sanitized string validation
    const sanitizedString = (minLength = 1, maxLength = 1000) => 
      Joi.string()
        .min(minLength)
        .max(maxLength)
        .custom((value, helpers) => {
          const sanitized = DOMPurify.sanitize(value, {
            ALLOWED_TAGS: [],
            ALLOWED_ATTR: []
          });
          
          if (sanitized !== value) {
            return helpers.error('string.xss');
          }
          
          return sanitized;
        });
    
    // User registration with enhanced security
    this.validators.set('userRegistration', Joi.object({
      email: Joi.string()
        .email({ tlds: { allow: true } })
        .max(255)
        .required(),
      password: Joi.string()
        .min(12) // Updated to 2025 standards
        .pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
        .required()
        .messages({
          'string.pattern.base': 'Password must contain uppercase, lowercase, number, and special character'
        }),
      firstName: sanitizedString(2, 50).required(),
      lastName: sanitizedString(2, 50).required(),
      acceptedTerms: Joi.boolean().valid(true).required(),
      captchaToken: Joi.string().required() // Anti-bot protection
    }));

    // Job description validator with nested validation
    this.validators.set('jobDescription', Joi.object({
      title: sanitizedString(3, 100).required(),
      company: sanitizedString(2, 100).required(),
      description: sanitizedString(50, 10000).required(),
      requirements: sanitizedString(0, 5000).optional(),
      location: Joi.object({
        city: sanitizedString(1, 100),
        state: sanitizedString(2, 2),
        country: sanitizedString(2, 100),
        remote: Joi.boolean()
      }).optional(),
      salary: Joi.object({
        min: safeInteger().positive(),
        max: safeInteger().positive().greater(Joi.ref('min')),
        currency: Joi.string().valid('USD', 'EUR', 'GBP').default('USD')
      }).optional(),
      keywords: Joi.array()
        .items(Joi.object({
          term: sanitizedString(1, 50),
          importance: safeInteger().min(1).max(100),
          category: Joi.string().valid('technical', 'soft', 'qualification')
        }))
        .max(100) // Limit array size
        .unique('term') // Prevent duplicate keywords
    }).unknown(false)); // Reject unknown fields
    
    // Resume validator with file metadata
    this.validators.set('resumeUpload', Joi.object({
      name: sanitizedString(1, 255).required(),
      fileMetadata: Joi.object({
        originalName: sanitizedString(1, 255),
        mimeType: Joi.string().valid(
          'application/pdf',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'application/msword',
          'text/plain'
        ),
        size: safeInteger().positive().max(10485760) // 10MB
      }).required(),
      tags: Joi.array()
        .items(sanitizedString(1, 30))
        .max(10)
        .optional()
    }));
  }

  async validate(schemaName, data, context = {}) {
    // Rate limiting per IP/user
    const rateLimitKey = context.ip || context.userId || 'anonymous';
    
    try {
      await this.rateLimiter.consume(rateLimitKey);
    } catch (error) {
      throw new ValidationError(
        'Too many validation attempts',
        'RATE_LIMITED'
      );
    }
    
    // Get validator
    const validator = this.validators.get(schemaName);
    if (!validator) {
      throw new ValidationError(
        'Invalid validation schema',
        'SCHEMA_NOT_FOUND'
      );
    }
    
    // Prevent prototype pollution
    const safeData = this.createSafeObject(data);
    
    try {
      // Validate with custom error handling
      const validated = await validator.validateAsync(safeData, {
        abortEarly: false,
        stripUnknown: true,
        context
      });
      
      return {
        valid: true,
        data: validated,
        sanitized: this.getSanitizationReport(data, validated)
      };
      
    } catch (error) {
      if (error.isJoi) {
        // Sanitize error messages
        const safeErrors = error.details.map(detail => ({
          field: this.sanitizePath(detail.path),
          message: this.sanitizeErrorMessage(detail.message),
          type: detail.type
        }));
        
        throw new ValidationError(
          'Validation failed',
          'VALIDATION_FAILED',
          safeErrors
        );
      }
      
      throw error;
    }
  }

  createSafeObject(data) {
    // Prevent prototype pollution
    const safe = Object.create(null);
    
    for (const [key, value] of Object.entries(data)) {
      // Skip dangerous keys
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
        continue;
      }
      
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        safe[key] = this.createSafeObject(value);
      } else if (Array.isArray(value)) {
        safe[key] = value.map(item => 
          typeof item === 'object' ? this.createSafeObject(item) : item
        );
      } else {
        safe[key] = value;
      }
    }
    
    return safe;
  }

  sanitizePath(path) {
    // Remove array indices and sensitive information
    return path
      .map(segment => typeof segment === 'number' ? '[*]' : segment)
      .join('.');
  }

  sanitizeErrorMessage(message) {
    // Remove potentially sensitive data from error messages
    return message
      .replace(/".+?"/g, '"[REDACTED]"')
      .replace(/\b\d{4,}\b/g, '[NUMBER]')
      .replace(/\b[\w._%+-]+@[\w.-]+\.[A-Z|a-z]{2,}\b/gi, '[EMAIL]');
  }

  getSanitizationReport(original, sanitized) {
    const report = {
      fieldsModified: [],
      xssAttempts: 0,
      injectionAttempts: 0
    };
    
    // Compare and report differences
    this.compareObjects(original, sanitized, '', report);
    
    return report;
  }

  compareObjects(original, sanitized, path, report) {
    for (const key in original) {
      const currentPath = path ? `${path}.${key}` : key;
      
      if (original[key] !== sanitized[key]) {
        report.fieldsModified.push(currentPath);
        
        // Detect XSS attempts
        if (typeof original[key] === 'string' && 
            (original[key].includes('<script') || 
             original[key].includes('javascript:'))) {
          report.xssAttempts++;
        }
      }
      
      if (typeof original[key] === 'object' && original[key] !== null) {
        this.compareObjects(
          original[key], 
          sanitized[key] || {}, 
          currentPath, 
          report
        );
      }
    }
  }
}

class ValidationError extends Error {
  constructor(message, code, details = []) {
    super(message);
    this.code = code;
    this.details = details;
    this.isOperational = true;
  }
}

// Create singleton instance
const secureValidationService = new SecureValidationService();

// User registration validation
const validateRegister = async (data, context = {}) => {
  try {
    const result = await secureValidationService.validate('userRegistration', data, context);
    return { error: null, value: result.data };
  } catch (error) {
    return { error, value: null };
  }
};

// User login validation
const validateLogin = (data) => {
  const schema = Joi.object({
    email: Joi.string().email().required().messages({
      'string.email': 'Please provide a valid email address',
      'any.required': 'Email is required'
    }),
    password: Joi.string().required().messages({
      'any.required': 'Password is required'
    })
  });

  return schema.validate(data);
};

// Resume upload validation
const validateResumeUpload = async (data, context = {}) => {
  try {
    const result = await secureValidationService.validate('resumeUpload', data, context);
    return { error: null, value: result.data };
  } catch (error) {
    return { error, value: null };
  }
};

// Job description validation
const validateJobDescription = async (data, context = {}) => {
  try {
    const result = await secureValidationService.validate('jobDescription', data, context);
    return { error: null, value: result.data };
  } catch (error) {
    return { error, value: null };
  }
};

// Optimization request validation
const validateOptimization = (data) => {
  const schema = Joi.object({
    resumeId: Joi.string().uuid().required().messages({
      'string.uuid': 'Invalid resume ID format',
      'any.required': 'Resume ID is required'
    }),
    jobDescriptionId: Joi.string().uuid().required().messages({
      'string.uuid': 'Invalid job description ID format',
      'any.required': 'Job description ID is required'
    }),
    optimizationLevel: Joi.string().valid('conservative', 'balanced', 'aggressive').default('balanced').messages({
      'any.only': 'Optimization level must be conservative, balanced, or aggressive'
    })
  });

  return schema.validate(data);
};

// Application tracking validation
const validateApplication = (data) => {
  const schema = Joi.object({
    companyName: Joi.string().min(1).max(255).required().messages({
      'string.min': 'Company name is required',
      'string.max': 'Company name cannot exceed 255 characters',
      'any.required': 'Company name is required'
    }),
    jobTitle: Joi.string().min(1).max(255).required().messages({
      'string.min': 'Job title is required',
      'string.max': 'Job title cannot exceed 255 characters',
      'any.required': 'Job title is required'
    }),
    applicationDate: Joi.date().required().messages({
      'any.required': 'Application date is required'
    }),
    status: Joi.string().valid('applied', 'reviewed', 'interview', 'rejected', 'offer').default('applied'),
    responseDate: Joi.date().optional(),
    interviewDate: Joi.date().optional(),
    notes: Joi.string().max(1000).optional(),
    optimizationId: Joi.string().uuid().optional()
  });

  return schema.validate(data);
};

module.exports = {
  validateRegister,
  validateLogin,
  validateResumeUpload,
  validateJobDescription,
  validateOptimization,
  validateApplication
};