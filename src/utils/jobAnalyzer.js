const logger = require('./logger');
const { LRUCache } = require('lru-cache');
const crypto = require('crypto');

class TrieNode {
  constructor() {
    this.children = new Map();
    this.isEndOfWord = false;
    this.metadata = null;
  }
}

class OptimizedJobAnalyzer {
  constructor() {
    this.keywordTrie = new TrieNode();
    this.analysisCache = new LRUCache({
      max: 1000,
      ttl: 1000 * 60 * 60 * 24, // 24 hours
      updateAgeOnGet: true
    });
    
    this.initializeKeywordDatabase();
  }

  async initializeKeywordDatabase() {
    // Load keyword database into Trie for O(n) searching
    const keywords = await this.loadKeywordDatabase();
    
    for (const keyword of keywords) {
      this.insertIntoTrie(keyword.term.toLowerCase(), keyword);
    }
    
    logger.info('Keyword database initialized', {
      keywordCount: keywords.length
    });
  }

  loadKeywordDatabase() {
    // Return comprehensive keyword database
    const keywords = [];
    
    // Programming Languages
    const programmingLanguages = [
      'javascript', 'python', 'java', 'c++', 'c#', 'php', 'ruby', 'go', 'rust',
      'typescript', 'kotlin', 'swift', 'scala', 'r', 'matlab'
    ];
    
    programmingLanguages.forEach(lang => {
      keywords.push({
        term: lang,
        category: 'technical',
        subcategory: 'Programming Languages',
        importance: 85
      });
    });
    
    // Web Technologies
    const webTech = [
      'html', 'css', 'react', 'angular', 'vue', 'node.js', 'express', 'django',
      'flask', 'spring', 'laravel', 'rails', 'asp.net'
    ];
    
    webTech.forEach(tech => {
      keywords.push({
        term: tech,
        category: 'technical',
        subcategory: 'Web Technologies',
        importance: 80
      });
    });
    
    // Add more categories...
    return keywords;
  }

  insertIntoTrie(word, metadata) {
    let node = this.keywordTrie;
    
    for (const char of word) {
      if (!node.children.has(char)) {
        node.children.set(char, new TrieNode());
      }
      node = node.children.get(char);
    }
    
    node.isEndOfWord = true;
    node.metadata = metadata;
  }

  async analyzeJob(description, requirements = '', options = {}) {
    const analysisId = crypto.randomBytes(16).toString('hex');
    const startTime = Date.now();
    
    try {
      // Check cache
      const cacheKey = this.generateCacheKey(description, requirements);
      const cached = this.analysisCache.get(cacheKey);
      
      if (cached && !options.forceAnalysis) {
        logger.info('Job analysis cache hit', { analysisId });
        return cached;
      }
      
      // Preprocess text
      const processedText = this.preprocessText(description, requirements);
      
      // Perform analysis in parallel
      const [
        keywords,
        industry,
        level,
        sentiment,
        complexity
      ] = await Promise.all([
        this.extractKeywordsOptimized(processedText),
        this.detectIndustryML(processedText),
        this.classifyJobLevel(processedText),
        this.analyzeSentiment(processedText),
        this.calculateComplexity(processedText)
      ]);
      
      // Generate insights
      const insights = await this.generateInsights({
        keywords,
        industry,
        level,
        sentiment,
        complexity
      });
      
      const result = {
        keywords,
        industry,
        level,
        sentiment,
        complexity,
        insights,
        metadata: {
          analysisId,
          timestamp: new Date().toISOString(),
          processingTime: Date.now() - startTime
        }
      };
      
      // Cache result
      this.analysisCache.set(cacheKey, result);
      
      return result;
      
    } catch (error) {
      logger.error('Job analysis failed', {
        analysisId,
        error: error.message
      });
      
      throw new AnalysisError(
        'Failed to analyze job description',
        'ANALYSIS_ERROR'
      );
    }
  }

  extractKeywordsOptimized(text) {
    const words = text.toLowerCase().split(/\s+/);
    const foundKeywords = new Map();
    const bigramKeywords = new Map();
    
    // Single pass for unigrams and bigrams
    for (let i = 0; i < words.length; i++) {
      // Check unigram
      const keyword = this.searchTrie(words[i]);
      if (keyword) {
        this.updateKeywordMap(foundKeywords, keyword);
      }
      
      // Check bigram
      if (i < words.length - 1) {
        const bigram = `${words[i]} ${words[i + 1]}`;
        const bigramKeyword = this.searchTrie(bigram);
        if (bigramKeyword) {
          this.updateKeywordMap(bigramKeywords, bigramKeyword);
        }
      }
    }
    
    // Merge and prioritize bigrams over unigrams
    return this.mergeKeywordMaps(foundKeywords, bigramKeywords);
  }

  searchTrie(word) {
    let node = this.keywordTrie;
    
    for (const char of word) {
      if (!node.children.has(char)) {
        return null;
      }
      node = node.children.get(char);
    }
    
    return node.isEndOfWord ? node.metadata : null;
  }

  updateKeywordMap(map, keyword) {
    const key = keyword.term;
    if (map.has(key)) {
      map.get(key).frequency++;
    } else {
      map.set(key, {
        ...keyword,
        frequency: 1
      });
    }
  }

  mergeKeywordMaps(unigrams, bigrams) {
    const result = [];
    
    // Add bigrams first (higher priority)
    for (const keyword of bigrams.values()) {
      result.push(keyword);
    }
    
    // Add unigrams that don't conflict with bigrams
    for (const keyword of unigrams.values()) {
      const conflicts = result.some(existing => 
        existing.term.includes(keyword.term) || keyword.term.includes(existing.term)
      );
      
      if (!conflicts) {
        result.push(keyword);
      }
    }
    
    return result.sort((a, b) => b.importance - a.importance);
  }

  preprocessText(description, requirements) {
    return `${description} ${requirements}`.toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  generateCacheKey(description, requirements) {
    const content = `${description}${requirements}`;
    return crypto.createHash('md5').update(content).digest('hex');
  }

  async detectIndustryML(text) {
    // Simplified industry detection - in production, use ML model
    const industryKeywords = {
      'Technology': ['software', 'tech', 'api', 'cloud', 'ai', 'machine learning'],
      'Finance': ['financial', 'bank', 'trading', 'investment', 'fintech'],
      'Healthcare': ['health', 'medical', 'patient', 'clinical', 'pharmaceutical'],
      'E-commerce': ['ecommerce', 'retail', 'marketplace', 'shopping']
    };
    
    let bestMatch = 'Other';
    let maxScore = 0;
    
    Object.entries(industryKeywords).forEach(([industry, keywords]) => {
      const score = keywords.reduce((acc, keyword) => {
        return acc + (text.includes(keyword) ? 1 : 0);
      }, 0);
      
      if (score > maxScore) {
        maxScore = score;
        bestMatch = industry;
      }
    });
    
    return {
      primary: bestMatch,
      confidence: maxScore / 10, // Normalize
      alternatives: []
    };
  }

  classifyJobLevel(text) {
    // Use existing logic from original implementation
    return classifyJobLevel('', text);
  }

  analyzeSentiment(text) {
    // Simple sentiment analysis - in production, use proper NLP library
    const positiveWords = ['exciting', 'innovative', 'growth', 'opportunity', 'collaborative'];
    const negativeWords = ['demanding', 'pressure', 'strict', 'challenging', 'difficult'];
    
    let score = 0;
    positiveWords.forEach(word => {
      if (text.includes(word)) score += 1;
    });
    negativeWords.forEach(word => {
      if (text.includes(word)) score -= 1;
    });
    
    return {
      score: score / 10, // Normalize to -1 to 1
      label: score > 0 ? 'positive' : score < 0 ? 'negative' : 'neutral'
    };
  }

  calculateComplexity(text) {
    // Use existing complexity calculation logic
    const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
    const words = text.split(/\s+/).filter(w => w.length > 0);
    
    const avgWordsPerSentence = words.length / sentences.length;
    const readingEase = 206.835 - 1.015 * avgWordsPerSentence;
    
    return {
      readingLevel: this.getReadingLevel(readingEase),
      score: Math.max(0, Math.min(100, readingEase)),
      avgSentenceLength: Math.round(avgWordsPerSentence)
    };
  }

  getReadingLevel(score) {
    if (score >= 90) return 'Very Easy';
    if (score >= 80) return 'Easy';
    if (score >= 70) return 'Fairly Easy';
    if (score >= 60) return 'Standard';
    if (score >= 50) return 'Fairly Difficult';
    if (score >= 30) return 'Difficult';
    return 'Very Difficult';
  }

  async generateInsights(analysis) {
    const insights = [];
    
    // Keyword insights
    const requiredKeywords = analysis.keywords.filter(k => k.type === 'required');
    
    if (requiredKeywords.length > 10) {
      insights.push({
        type: 'warning',
        message: 'High number of required keywords may limit candidate pool',
        impact: 'high',
        recommendation: 'Consider marking some keywords as preferred instead of required'
      });
    }
    
    // Industry alignment
    if (analysis.industry.confidence < 0.6) {
      insights.push({
        type: 'info',
        message: 'Job description spans multiple industries',
        impact: 'medium',
        recommendation: 'Consider adding industry-specific keywords for clarity'
      });
    }
    
    return insights;
  }
}

class AnalysisError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
    this.isOperational = true;
  }
}

// Create singleton instance
const optimizedJobAnalyzer = new OptimizedJobAnalyzer();

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

// Wrapper functions for backward compatibility
const extractJobKeywordsWrapper = async (description, requirements = '') => {
  try {
    const analysis = await optimizedJobAnalyzer.analyzeJob(description, requirements);
    return analysis.keywords;
  } catch (error) {
    logger.error('Optimized keyword extraction failed, falling back to basic', { error: error.message });
    
    // Fallback to original implementation
    return extractJobKeywords(description, requirements);
  }
};

module.exports = {
  extractJobKeywords: extractJobKeywordsWrapper,
  extractJobKeywordsOriginal: extractJobKeywords,
  classifyJobLevel,
  detectIndustry,
  extractSalaryInfo,
  extractLocation,
  calculateImportance,
  determineRequirementType,
  OptimizedJobAnalyzer
};