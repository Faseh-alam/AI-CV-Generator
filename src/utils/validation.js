const Joi = require('joi');

// User registration validation
const validateRegister = (data) => {
  const schema = Joi.object({
    email: Joi.string().email().required().messages({
      'string.email': 'Please provide a valid email address',
      'any.required': 'Email is required'
    }),
    password: Joi.string().min(8).pattern(new RegExp('^(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9])(?=.*[!@#\$%\^&\*])')).required().messages({
      'string.min': 'Password must be at least 8 characters long',
      'string.pattern.base': 'Password must contain at least one lowercase letter, one uppercase letter, one number, and one special character',
      'any.required': 'Password is required'
    }),
    firstName: Joi.string().min(2).max(50).required().messages({
      'string.min': 'First name must be at least 2 characters long',
      'string.max': 'First name cannot exceed 50 characters',
      'any.required': 'First name is required'
    }),
    lastName: Joi.string().min(2).max(50).required().messages({
      'string.min': 'Last name must be at least 2 characters long',
      'string.max': 'Last name cannot exceed 50 characters',
      'any.required': 'Last name is required'
    })
  });

  return schema.validate(data);
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
const validateResumeUpload = (data) => {
  const schema = Joi.object({
    name: Joi.string().min(1).max(255).required().messages({
      'string.min': 'Resume name is required',
      'string.max': 'Resume name cannot exceed 255 characters',
      'any.required': 'Resume name is required'
    }),
    isDefault: Joi.boolean().default(false)
  });

  return schema.validate(data);
};

// Job description validation
const validateJobDescription = (data) => {
  const schema = Joi.object({
    title: Joi.string().min(1).max(255).required().messages({
      'string.min': 'Job title is required',
      'string.max': 'Job title cannot exceed 255 characters',
      'any.required': 'Job title is required'
    }),
    company: Joi.string().max(255).optional(),
    description: Joi.string().min(10).max(10000).required().messages({
      'string.min': 'Job description must be at least 10 characters long',
      'string.max': 'Job description cannot exceed 10,000 characters',
      'any.required': 'Job description is required'
    }),
    requirements: Joi.string().max(5000).optional(),
    location: Joi.string().max(255).optional(),
    salaryRange: Joi.string().max(100).optional(),
    url: Joi.string().uri().optional()
  });

  return schema.validate(data);
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