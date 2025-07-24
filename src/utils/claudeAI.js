const axios = require('axios');
const crypto = require('crypto');
const CircuitBreaker = require('opossum');
const { KMS } = require('aws-sdk');
const logger = require('./logger');

const CLAUDE_API_URL = process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com';

class SecureClaudeService {
  constructor() {
    this.kms = new KMS();
    this.apiKey = null;
    this.keyRotationInterval = 24 * 60 * 60 * 1000; // 24 hours
    
    // Circuit breaker configuration
    this.circuitBreakerOptions = {
      timeout: 30000,
      errorThresholdPercentage: 50,
      resetTimeout: 30000,
      rollingCountTimeout: 10000,
      rollingCountBuckets: 10,
      name: 'claude-api'
    };
    
    this.initializeService();
  }

  async initializeService() {
    try {
      // Decrypt API key from KMS
      await this.rotateApiKey();
      
      // Schedule key rotation
      setInterval(() => this.rotateApiKey(), this.keyRotationInterval);
    } catch (error) {
      logger.error('Failed to initialize Claude service', { error: error.message });
    }
  }

  async rotateApiKey() {
    try {
      if (process.env.ENCRYPTED_CLAUDE_API_KEY) {
        const { Plaintext } = await this.kms.decrypt({
          CiphertextBlob: Buffer.from(process.env.ENCRYPTED_CLAUDE_API_KEY, 'base64')
        }).promise();
        
        this.apiKey = Plaintext.toString();
        logger.info('Claude API key rotated successfully');
      } else {
        // Fallback to plain text for development
        this.apiKey = process.env.ANTHROPIC_API_KEY;
        logger.warn('Using plain text API key - not recommended for production');
      }
    } catch (error) {
      logger.error('Failed to rotate API key', { error: error.message });
      throw new Error('Service initialization failed');
    }
  }

  createSecureRequest(endpoint, data) {
    const timestamp = Date.now();
    const nonce = crypto.randomBytes(16).toString('hex');
    
    // Create request signature
    const payload = JSON.stringify({
      endpoint,
      data,
      timestamp,
      nonce
    });
    
    const signature = crypto
      .createHmac('sha256', this.apiKey)
      .update(payload)
      .digest('hex');
    
    return {
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'x-timestamp': timestamp,
        'x-nonce': nonce,
        'x-signature': signature,
        'anthropic-version': '2023-06-01'
      },
      data
    };
  }

  async analyzeJobWithCircuitBreaker(description, requirements) {
    const operation = async () => {
      try {
        const request = this.createSecureRequest('/v1/messages', {
          model: 'claude-3-sonnet-20240229',
          max_tokens: 2000,
          temperature: 0.1,
          messages: [{
            role: 'user',
            content: this.createJobAnalysisPrompt(description, requirements)
          }]
        });

        const response = await axios.post(
          `${CLAUDE_API_URL}/v1/messages`,
          request.data,
          { 
            headers: request.headers,
            timeout: 25000 // 25 second timeout
          }
        );

        return this.parseJobAnalysisResponse(response.data);
      } catch (error) {
        // Sanitize error before logging
        const sanitizedError = this.sanitizeError(error);
        logger.error('Claude API call failed', sanitizedError);
        
        // Throw user-friendly error
        if (error.response?.status === 429) {
          throw new ServiceError('AI service is busy, please try again later', 'RATE_LIMITED');
        } else if (error.response?.status === 401) {
          throw new ServiceError('AI service configuration error', 'AUTH_ERROR');
        } else {
          throw new ServiceError('AI analysis temporarily unavailable', 'SERVICE_ERROR');
        }
      }
    };

    // Create circuit breaker
    const breaker = new CircuitBreaker(operation, this.circuitBreakerOptions);
    
    // Add event listeners
    breaker.on('open', () => {
      logger.warn('Claude API circuit breaker opened');
    });
    
    breaker.on('halfOpen', () => {
      logger.info('Claude API circuit breaker half-open, testing...');
    });

    return breaker.fire();
  }

  sanitizeError(error) {
    const sanitized = {
      status: error.response?.status,
      code: error.code,
      timestamp: new Date().toISOString()
    };
    
    // Only include safe error details
    if (error.response?.data?.error?.type) {
      sanitized.errorType = error.response.data.error.type;
    }
    
    return sanitized;
  }

  createJobAnalysisPrompt(description, requirements) {
    // Validate and sanitize inputs
    const sanitizedDescription = this.sanitizeInput(description);
    const sanitizedRequirements = this.sanitizeInput(requirements);
    
    return `You are an expert job analysis system. Analyze the following job description and extract structured information.

JOB DESCRIPTION:
${sanitizedDescription}

${sanitizedRequirements ? `REQUIREMENTS:\n${sanitizedRequirements}` : ''}

Please analyze this job posting and return a JSON response with the following structure:
{
  "keywords": [
    {
      "term": "keyword or phrase",
      "category": "technical|soft|qualification|certification|tool|framework",
      "importance": 1-100,
      "type": "required|preferred",
      "frequency": 1
    }
  ],
  "requirements": {
    "required": ["list of required qualifications"],
    "preferred": ["list of preferred qualifications"],
    "experience_years": "number or range",
    "education_level": "degree requirement"
  },
  "skills": {
    "technical": ["technical skills"],
    "soft": ["soft skills"],
    "tools": ["tools and software"],
    "frameworks": ["frameworks and libraries"]
  }
}

Focus on:
1. Extract ALL relevant keywords and phrases
2. Categorize each keyword appropriately
3. Assign importance scores (1-100) based on frequency and context
4. Distinguish between required vs preferred qualifications
5. Identify technical skills, tools, frameworks, and soft skills
6. Extract experience requirements and education level

Return only valid JSON without any additional text or formatting.`;
  }

  sanitizeInput(input) {
    if (!input) return '';
    
    // Remove potential prompt injection attempts
    return input
      .replace(/\[INST\]/gi, '')
      .replace(/\[\/INST\]/gi, '')
      .replace(/Human:/gi, '')
      .replace(/Assistant:/gi, '')
      .substring(0, 10000); // Limit length
  }

  parseJobAnalysisResponse(data) {
    try {
      const content = data.content[0].text;
      const analysis = JSON.parse(content);
      
      // Validate and clean the response
      return {
        keywords: analysis.keywords || [],
        requirements: analysis.requirements || {},
        skills: analysis.skills || {}
      };
    } catch (parseError) {
      logger.error('Failed to parse Claude response:', parseError);
      throw new ServiceError('Failed to parse AI response', 'PARSE_ERROR');
    }
  }
}

class ServiceError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
    this.isOperational = true;
  }
}

// Create singleton instance
const secureClaudeService = new SecureClaudeService();

// Analyze job description with Claude AI
const analyzeJobWithClaude = async (description, requirements = '') => {
  try {
    if (!secureClaudeService.apiKey) {
      throw new Error('Claude API key not configured');
    }

    return await secureClaudeService.analyzeJobWithCircuitBreaker(description, requirements);

  } catch (error) {
    logger.error('Claude API error:', error);
    
    if (error.code === 'RATE_LIMITED') {
      throw new Error('Claude API rate limit exceeded');
    } else if (error.code === 'AUTH_ERROR') {
      throw new Error('Claude API authentication failed');
    } else if (error.code === 'SERVICE_ERROR') {
      // Fallback to basic keyword extraction
      return await fallbackJobAnalysis(description, requirements);
    } else {
      throw new Error(`Claude API error: ${error.message}`);
    }
  }
};

// Optimize resume with Claude AI
const optimizeResumeWithClaude = async (resumeData, jobKeywords, optimizationLevel = 'balanced') => {
  try {
    if (!CLAUDE_API_KEY) {
      throw new Error('Claude API key not configured');
    }

    const optimizationInstructions = {
      conservative: 'Make minimal changes, focus on keyword integration and formatting',
      balanced: 'Moderate optimization with keyword integration and content enhancement',
      aggressive: 'Comprehensive optimization with significant content restructuring'
    };

    const prompt = `
You are an expert resume optimizer specializing in ATS (Applicant Tracking System) compatibility. Your task is to optimize the following resume for a specific job while maintaining factual accuracy and professional tone.

OPTIMIZATION LEVEL: ${optimizationLevel}
INSTRUCTIONS: ${optimizationInstructions[optimizationLevel]}

ORIGINAL RESUME DATA:
${JSON.stringify(resumeData, null, 2)}

TARGET JOB KEYWORDS:
${JSON.stringify(jobKeywords, null, 2)}

OPTIMIZATION GUIDELINES:
1. Integrate keywords naturally (avoid keyword stuffing)
2. Rewrite experience descriptions for relevance
3. Quantify achievements where possible
4. Maintain chronological integrity
5. Preserve all factual information
6. Use action verbs and industry terminology
7. Target 70%+ keyword coverage
8. Ensure ATS compatibility

IMPORTANT RULES:
- DO NOT invent or fabricate any experience, skills, or achievements
- DO NOT change dates, company names, or job titles unless for formatting
- DO maintain the original structure and factual content
- DO enhance descriptions to highlight relevant experience

Please return a JSON response with:
{
  "optimizedResume": {
    "personal": { ... },
    "experience": [ ... ],
    "education": [ ... ],
    "skills": { ... },
    "certifications": [ ... ]
  },
  "changes": [
    {
      "section": "section name",
      "change": "description of change made",
      "impact": "expected impact on ATS score"
    }
  ],
  "keywordCoverage": {
    "integrated": ["keywords successfully integrated"],
    "missing": ["keywords that couldn't be naturally integrated"],
    "coverage": "percentage"
  }
}

Return only valid JSON without any additional text or formatting.
`;

    const response = await claudeAPI.post('/v1/messages', {
      model: 'claude-3-sonnet-20240229',
      max_tokens: 3000,
      temperature: 0.3,
      messages: [
        {
          role: 'user',
          content: prompt
        }
      ]
    });

    const content = response.data.content[0].text;
    
    try {
      const optimization = JSON.parse(content);
      
      return {
        optimizedContent: optimization.optimizedResume || resumeData,
        changes: optimization.changes || [],
        keywordCoverage: optimization.keywordCoverage || { coverage: '0%' }
      };
    } catch (parseError) {
      logger.error('Failed to parse Claude optimization response:', parseError);
      throw new Error('Failed to parse AI optimization response');
    }

  } catch (error) {
    logger.error('Claude optimization error:', error);
    
    if (error.response?.status === 429) {
      throw new Error('Claude API rate limit exceeded');
    } else if (error.response?.status === 401) {
      throw new Error('Claude API authentication failed');
    } else {
      throw new Error(`Claude API error: ${error.message}`);
    }
  }
};

// Fallback job analysis when Claude API fails
const fallbackJobAnalysis = async (description, requirements = '') => {
  const text = `${description} ${requirements}`.toLowerCase();
  const keywords = [];
  
  // Basic keyword extraction patterns
  const technicalSkills = [
    'javascript', 'python', 'java', 'react', 'node.js', 'sql', 'aws', 'docker',
    'kubernetes', 'git', 'html', 'css', 'typescript', 'mongodb', 'postgresql'
  ];
  
  const softSkills = [
    'communication', 'leadership', 'teamwork', 'problem solving', 'analytical',
    'creative', 'organized', 'detail-oriented', 'collaborative'
  ];
  
  // Extract technical skills
  technicalSkills.forEach(skill => {
    if (text.includes(skill)) {
      keywords.push({
        term: skill,
        category: 'technical',
        importance: 80,
        type: 'required',
        frequency: 1
      });
    }
  });
  
  // Extract soft skills
  softSkills.forEach(skill => {
    if (text.includes(skill)) {
      keywords.push({
        term: skill,
        category: 'soft',
        importance: 60,
        type: 'preferred',
        frequency: 1
      });
    }
  });
  
  return {
    keywords,
    requirements: {
      required: [],
      preferred: [],
      experience_years: '',
      education_level: ''
    },
    skills: {
      technical: technicalSkills.filter(skill => text.includes(skill)),
      soft: softSkills.filter(skill => text.includes(skill)),
      tools: [],
      frameworks: []
    }
  };
};

// Test Claude API connection
const testClaudeConnection = async () => {
  try {
    if (!CLAUDE_API_KEY) {
      return { connected: false, error: 'API key not configured' };
    }

    const response = await claudeAPI.post('/v1/messages', {
      model: 'claude-3-sonnet-20240229',
      max_tokens: 10,
      messages: [
        {
          role: 'user',
          content: 'Hello'
        }
      ]
    });

    return { connected: true, model: 'claude-3-sonnet-20240229' };
  } catch (error) {
    return { 
      connected: false, 
      error: error.response?.data?.error?.message || error.message 
    };
  }
};

module.exports = {
  analyzeJobWithClaude,
  optimizeResumeWithClaude,
  fallbackJobAnalysis,
  testClaudeConnection
};