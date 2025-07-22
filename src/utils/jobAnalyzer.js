const logger = require('./logger');

// Extract keywords from job description using NLP techniques
const extractJobKeywords = (description, requirements = '') => {
  const text = `${description} ${requirements}`.toLowerCase();
  const keywords = [];
  
  // Common technical skills and tools
  const technicalPatterns = {
    'Programming Languages': [
      'javascript', 'python', 'java', 'c++', 'c#', 'php', 'ruby', 'go', 'rust',
      'typescript', 'kotlin', 'swift', 'scala', 'r', 'matlab'
    ],
    'Web Technologies': [
      'html', 'css', 'react', 'angular', 'vue', 'node.js', 'express', 'django',
      'flask', 'spring', 'laravel', 'rails', 'asp.net'
    ],
    'Databases': [
      'sql', 'mysql', 'postgresql', 'mongodb', 'redis', 'elasticsearch',
      'oracle', 'sqlite', 'cassandra', 'dynamodb'
    ],
    'Cloud & DevOps': [
      'aws', 'azure', 'gcp', 'docker', 'kubernetes', 'jenkins', 'git',
      'terraform', 'ansible', 'ci/cd', 'microservices'
    ],
    'Data & Analytics': [
      'machine learning', 'data science', 'analytics', 'tableau', 'power bi',
      'spark', 'hadoop', 'pandas', 'numpy', 'tensorflow', 'pytorch'
    ]
  };
  
  // Soft skills patterns
  const softSkills = [
    'communication', 'leadership', 'teamwork', 'problem solving', 'analytical',
    'creative', 'organized', 'detail-oriented', 'collaborative', 'adaptable',
    'time management', 'critical thinking', 'project management'
  ];
  
  // Qualification patterns
  const qualificationPatterns = [
    'bachelor', 'master', 'phd', 'degree', 'certification', 'years experience',
    'experience required', 'minimum experience'
  ];
  
  // Extract technical keywords
  Object.entries(technicalPatterns).forEach(([category, skills]) => {
    skills.forEach(skill => {
      const regex = new RegExp(`\\b${skill.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
      const matches = text.match(regex);
      if (matches) {
        keywords.push({
          term: skill,
          category: 'technical',
          importance: calculateImportance(skill, text, matches.length),
          type: determineRequirementType(skill, text),
          frequency: matches.length,
          subcategory: category
        });
      }
    });
  });
  
  // Extract soft skills
  softSkills.forEach(skill => {
    const regex = new RegExp(`\\b${skill.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
    const matches = text.match(regex);
    if (matches) {
      keywords.push({
        term: skill,
        category: 'soft',
        importance: calculateImportance(skill, text, matches.length, 'soft'),
        type: determineRequirementType(skill, text),
        frequency: matches.length
      });
    }
  });
  
  // Extract qualifications
  qualificationPatterns.forEach(pattern => {
    const regex = new RegExp(`\\b${pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
    const matches = text.match(regex);
    if (matches) {
      keywords.push({
        term: pattern,
        category: 'qualification',
        importance: calculateImportance(pattern, text, matches.length, 'qualification'),
        type: 'required',
        frequency: matches.length
      });
    }
  });
  
  // Extract years of experience
  const experienceRegex = /(\d+)[\+\-\s]*years?\s+(?:of\s+)?experience/gi;
  const experienceMatches = text.match(experienceRegex);
  if (experienceMatches) {
    experienceMatches.forEach(match => {
      const years = match.match(/\d+/)[0];
      keywords.push({
        term: `${years}+ years experience`,
        category: 'qualification',
        importance: 90,
        type: 'required',
        frequency: 1
      });
    });
  }
  
  // Sort by importance and remove duplicates
  const uniqueKeywords = keywords.reduce((acc, current) => {
    const existing = acc.find(item => item.term.toLowerCase() === current.term.toLowerCase());
    if (!existing) {
      acc.push(current);
    } else if (current.importance > existing.importance) {
      acc[acc.indexOf(existing)] = current;
    }
    return acc;
  }, []);
  
  return uniqueKeywords.sort((a, b) => b.importance - a.importance);
};

// Calculate importance score for a keyword
const calculateImportance = (keyword, text, frequency, category = 'technical') => {
  let baseScore = 50;
  
  // Frequency bonus
  baseScore += Math.min(frequency * 10, 30);
  
  // Position bonus (keywords mentioned early are more important)
  const firstOccurrence = text.indexOf(keyword.toLowerCase());
  const textLength = text.length;
  const positionScore = Math.max(0, 20 - (firstOccurrence / textLength) * 20);
  baseScore += positionScore;
  
  // Context bonus
  const contextPatterns = {
    required: ['required', 'must have', 'essential', 'mandatory'],
    preferred: ['preferred', 'nice to have', 'bonus', 'plus'],
    experience: ['experience', 'years', 'proficient', 'expert']
  };
  
  Object.entries(contextPatterns).forEach(([type, patterns]) => {
    patterns.forEach(pattern => {
      const contextRegex = new RegExp(`${pattern}[^.]*${keyword}|${keyword}[^.]*${pattern}`, 'gi');
      if (contextRegex.test(text)) {
        baseScore += type === 'required' ? 20 : type === 'experience' ? 15 : 10;
      }
    });
  });
  
  // Category-specific adjustments
  if (category === 'technical') {
    baseScore += 10; // Technical skills are generally more important
  } else if (category === 'qualification') {
    baseScore += 15; // Qualifications are very important
  }
  
  return Math.min(100, Math.max(1, Math.round(baseScore)));
};

// Determine if a keyword is required or preferred
const determineRequirementType = (keyword, text) => {
  const requiredPatterns = [
    'required', 'must have', 'essential', 'mandatory', 'minimum',
    'at least', 'minimum of', 'requires'
  ];
  
  const preferredPatterns = [
    'preferred', 'nice to have', 'bonus', 'plus', 'advantage',
    'would be great', 'ideal candidate'
  ];
  
  // Check context around the keyword
  const keywordIndex = text.indexOf(keyword.toLowerCase());
  if (keywordIndex === -1) return 'preferred';
  
  const contextStart = Math.max(0, keywordIndex - 100);
  const contextEnd = Math.min(text.length, keywordIndex + 100);
  const context = text.substring(contextStart, contextEnd);
  
  // Check for required indicators
  for (const pattern of requiredPatterns) {
    if (context.includes(pattern)) {
      return 'required';
    }
  }
  
  // Check for preferred indicators
  for (const pattern of preferredPatterns) {
    if (context.includes(pattern)) {
      return 'preferred';
    }
  }
  
  // Default to required for technical skills, preferred for soft skills
  return keyword.match(/javascript|python|java|react|sql|aws/) ? 'required' : 'preferred';
};

// Classify job level based on title and description
const classifyJobLevel = (title, description) => {
  const titleLower = title.toLowerCase();
  const descriptionLower = description.toLowerCase();
  
  // Executive level indicators
  const executiveIndicators = [
    'ceo', 'cto', 'cfo', 'vp', 'vice president', 'director', 'head of',
    'chief', 'executive', 'president'
  ];
  
  // Senior level indicators
  const seniorIndicators = [
    'senior', 'lead', 'principal', 'staff', 'architect', 'manager',
    'team lead', 'tech lead'
  ];
  
  // Junior level indicators
  const juniorIndicators = [
    'junior', 'entry', 'associate', 'intern', 'trainee', 'graduate',
    'entry level', 'new grad'
  ];
  
  // Check title first
  if (executiveIndicators.some(indicator => titleLower.includes(indicator))) {
    return 'executive';
  }
  
  if (seniorIndicators.some(indicator => titleLower.includes(indicator))) {
    return 'senior';
  }
  
  if (juniorIndicators.some(indicator => titleLower.includes(indicator))) {
    return 'entry';
  }
  
  // Check description for experience requirements
  const experienceRegex = /(\d+)[\+\-\s]*years?\s+(?:of\s+)?experience/gi;
  const experienceMatches = descriptionLower.match(experienceRegex);
  
  if (experienceMatches) {
    const years = Math.max(...experienceMatches.map(match => {
      const yearMatch = match.match(/\d+/);
      return yearMatch ? parseInt(yearMatch[0]) : 0;
    }));
    
    if (years >= 8) return 'senior';
    if (years >= 3) return 'mid';
    if (years >= 0) return 'entry';
  }
  
  // Default classification based on description complexity
  const complexityIndicators = [
    'architecture', 'design', 'strategy', 'leadership', 'mentoring',
    'cross-functional', 'stakeholder', 'roadmap'
  ];
  
  const complexityScore = complexityIndicators.reduce((score, indicator) => {
    return score + (descriptionLower.includes(indicator) ? 1 : 0);
  }, 0);
  
  if (complexityScore >= 4) return 'senior';
  if (complexityScore >= 2) return 'mid';
  
  return 'entry';
};

// Detect industry from job description
const detectIndustry = (description) => {
  const descriptionLower = description.toLowerCase();
  
  const industryPatterns = {
    'Technology': [
      'software', 'tech', 'startup', 'saas', 'platform', 'api', 'mobile app',
      'web development', 'cloud', 'ai', 'machine learning', 'data science'
    ],
    'Finance': [
      'bank', 'financial', 'fintech', 'trading', 'investment', 'insurance',
      'credit', 'loan', 'payment', 'blockchain', 'cryptocurrency'
    ],
    'Healthcare': [
      'health', 'medical', 'hospital', 'clinic', 'pharmaceutical', 'biotech',
      'patient', 'healthcare', 'medicine', 'clinical'
    ],
    'E-commerce': [
      'ecommerce', 'e-commerce', 'retail', 'marketplace', 'shopping',
      'consumer', 'product catalog', 'inventory'
    ],
    'Education': [
      'education', 'learning', 'school', 'university', 'training',
      'curriculum', 'student', 'academic'
    ],
    'Marketing': [
      'marketing', 'advertising', 'brand', 'campaign', 'social media',
      'content', 'seo', 'digital marketing', 'growth'
    ],
    'Media': [
      'media', 'entertainment', 'content', 'publishing', 'news',
      'streaming', 'video', 'audio', 'broadcast'
    ],
    'Manufacturing': [
      'manufacturing', 'production', 'factory', 'supply chain',
      'logistics', 'operations', 'quality control'
    ]
  };
  
  let bestMatch = 'Other';
  let maxScore = 0;
  
  Object.entries(industryPatterns).forEach(([industry, keywords]) => {
    const score = keywords.reduce((acc, keyword) => {
      return acc + (descriptionLower.includes(keyword) ? 1 : 0);
    }, 0);
    
    if (score > maxScore) {
      maxScore = score;
      bestMatch = industry;
    }
  });
  
  return bestMatch;
};

// Extract salary information
const extractSalaryInfo = (description) => {
  const salaryPatterns = [
    /\$(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)\s*(?:-|to)\s*\$(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/gi,
    /\$(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)\s*(?:k|thousand)/gi,
    /(\d{1,3}(?:,\d{3})*)\s*(?:-|to)\s*(\d{1,3}(?:,\d{3})*)\s*(?:k|thousand)/gi
  ];
  
  for (const pattern of salaryPatterns) {
    const match = description.match(pattern);
    if (match) {
      return match[0];
    }
  }
  
  return null;
};

// Extract location information
const extractLocation = (description) => {
  const locationPatterns = [
    /(?:location|based in|located in):\s*([^,\n]+)/gi,
    /([A-Z][a-z]+,\s*[A-Z]{2})/g, // City, State format
    /\b(remote|work from home|wfh)\b/gi
  ];
  
  for (const pattern of locationPatterns) {
    const match = description.match(pattern);
    if (match) {
      return match[0];
    }
  }
  
  return null;
};

module.exports = {
  extractJobKeywords,
  classifyJobLevel,
  detectIndustry,
  extractSalaryInfo,
  extractLocation,
  calculateImportance,
  determineRequirementType
};