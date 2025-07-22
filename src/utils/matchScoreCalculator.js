const logger = require('./logger');

// Calculate match score between resume and job requirements
const calculateResumeMatchScore = async (resumeData, jobKeywords) => {
  try {
    if (!resumeData || !jobKeywords) {
      throw new Error('Resume data and job keywords are required');
    }

    // Convert resume to searchable text
    const resumeText = extractAllText(resumeData).toLowerCase();
    
    // Ensure jobKeywords is an array
    const keywords = Array.isArray(jobKeywords) ? jobKeywords : jobKeywords.keywords || [];
    
    if (keywords.length === 0) {
      return {
        overallScore: 0,
        breakdown: {
          keywordMatch: 0,
          experienceRelevance: 0,
          skillsAlignment: 0,
          educationMatch: 0
        },
        missingKeywords: [],
        matchedKeywords: [],
        improvementSuggestions: []
      };
    }

    // Calculate individual scores
    const keywordScore = calculateKeywordMatch(resumeText, keywords);
    const experienceScore = calculateExperienceRelevance(resumeData.experience || [], keywords);
    const skillsScore = calculateSkillsAlignment(resumeData.skills || {}, keywords);
    const educationScore = calculateEducationMatch(resumeData.education || [], keywords);

    // Weighted overall score
    const overallScore = Math.round(
      keywordScore.score * 0.4 +
      experienceScore.score * 0.3 +
      skillsScore.score * 0.15 +
      educationScore.score * 0.15
    );

    // Generate improvement suggestions
    const improvementSuggestions = generateImprovementSuggestions(
      keywordScore,
      experienceScore,
      skillsScore,
      educationScore
    );

    return {
      overallScore: Math.min(100, Math.max(0, overallScore)),
      breakdown: {
        keywordMatch: keywordScore.score,
        experienceRelevance: experienceScore.score,
        skillsAlignment: skillsScore.score,
        educationMatch: educationScore.score
      },
      missingKeywords: keywordScore.missing,
      matchedKeywords: keywordScore.matched,
      improvementSuggestions
    };
  } catch (error) {
    logger.error('Match score calculation error:', error);
    throw new Error(`Match score calculation failed: ${error.message}`);
  }
};

// Extract all text from resume data
const extractAllText = (resumeData) => {
  let text = '';
  
  // Personal information
  if (resumeData.personal) {
    text += Object.values(resumeData.personal).join(' ') + ' ';
  }
  
  // Experience
  if (resumeData.experience && Array.isArray(resumeData.experience)) {
    resumeData.experience.forEach(exp => {
      text += `${exp.title || ''} ${exp.company || ''} ${exp.description || ''} `;
      if (exp.achievements && Array.isArray(exp.achievements)) {
        text += exp.achievements.join(' ') + ' ';
      }
    });
  }
  
  // Education
  if (resumeData.education && Array.isArray(resumeData.education)) {
    resumeData.education.forEach(edu => {
      text += `${edu.degree || ''} ${edu.field || ''} ${edu.institution || ''} `;
    });
  }
  
  // Skills
  if (resumeData.skills) {
    if (resumeData.skills.technical && Array.isArray(resumeData.skills.technical)) {
      text += resumeData.skills.technical.join(' ') + ' ';
    }
    if (resumeData.skills.soft && Array.isArray(resumeData.skills.soft)) {
      text += resumeData.skills.soft.join(' ') + ' ';
    }
    if (resumeData.skills.languages && Array.isArray(resumeData.skills.languages)) {
      text += resumeData.skills.languages.join(' ') + ' ';
    }
  }
  
  // Certifications
  if (resumeData.certifications && Array.isArray(resumeData.certifications)) {
    resumeData.certifications.forEach(cert => {
      text += `${cert.name || ''} ${cert.issuer || ''} `;
    });
  }
  
  return text;
};

// Calculate keyword matching score
const calculateKeywordMatch = (resumeText, keywords) => {
  let totalScore = 0;
  let maxPossibleScore = 0;
  const matched = [];
  const missing = [];
  
  keywords.forEach(keyword => {
    const keywordObj = typeof keyword === 'string' ? { term: keyword, importance: 50 } : keyword;
    const term = keywordObj.term.toLowerCase();
    const importance = keywordObj.importance || 50;
    const weight = importance / 100;
    
    maxPossibleScore += weight * 100;
    
    // Check for exact match
    if (resumeText.includes(term)) {
      totalScore += weight * 100;
      matched.push({
        term: keywordObj.term,
        importance,
        matchType: 'exact'
      });
    } else {
      // Check for partial matches and synonyms
      const synonyms = getSynonyms(term);
      let partialMatch = false;
      
      for (const synonym of synonyms) {
        if (resumeText.includes(synonym.toLowerCase())) {
          totalScore += weight * 70; // 70% credit for synonym match
          matched.push({
            term: keywordObj.term,
            importance,
            matchType: 'synonym',
            matchedAs: synonym
          });
          partialMatch = true;
          break;
        }
      }
      
      if (!partialMatch) {
        // Check for partial word matches
        const words = term.split(' ');
        const matchedWords = words.filter(word => resumeText.includes(word));
        
        if (matchedWords.length > 0) {
          const partialScore = (matchedWords.length / words.length) * weight * 50;
          totalScore += partialScore;
          matched.push({
            term: keywordObj.term,
            importance,
            matchType: 'partial',
            matchedWords
          });
        } else {
          missing.push({
            term: keywordObj.term,
            importance,
            suggestions: generateKeywordSuggestions(keywordObj.term)
          });
        }
      }
    }
  });
  
  const score = maxPossibleScore > 0 ? Math.round((totalScore / maxPossibleScore) * 100) : 0;
  
  return {
    score: Math.min(100, Math.max(0, score)),
    matched,
    missing,
    coverage: keywords.length > 0 ? Math.round((matched.length / keywords.length) * 100) : 0
  };
};

// Calculate experience relevance score
const calculateExperienceRelevance = (experience, keywords) => {
  if (!experience || experience.length === 0) {
    return { score: 0, feedback: 'No work experience found' };
  }
  
  let relevanceScore = 0;
  let totalJobs = experience.length;
  
  // Get technical keywords for experience matching
  const technicalKeywords = keywords.filter(k => 
    (typeof k === 'object' && k.category === 'technical') || 
    (typeof k === 'string' && isTechnicalKeyword(k))
  );
  
  experience.forEach(job => {
    const jobText = `${job.title || ''} ${job.company || ''} ${job.description || ''} ${(job.achievements || []).join(' ')}`.toLowerCase();
    
    let jobRelevance = 0;
    let matchedKeywords = 0;
    
    technicalKeywords.forEach(keyword => {
      const term = typeof keyword === 'string' ? keyword : keyword.term;
      if (jobText.includes(term.toLowerCase())) {
        matchedKeywords++;
        jobRelevance += (typeof keyword === 'object' ? keyword.importance : 50) || 50;
      }
    });
    
    // Bonus for recent experience (last 5 years)
    const endDate = job.endDate || 'present';
    if (endDate.toLowerCase().includes('present') || endDate.toLowerCase().includes('current')) {
      jobRelevance *= 1.2;
    }
    
    relevanceScore += jobRelevance;
  });
  
  const maxPossibleScore = technicalKeywords.length * totalJobs * 50;
  const score = maxPossibleScore > 0 ? Math.round((relevanceScore / maxPossibleScore) * 100) : 0;
  
  return {
    score: Math.min(100, Math.max(0, score)),
    feedback: `${totalJobs} job(s) analyzed for relevance`
  };
};

// Calculate skills alignment score
const calculateSkillsAlignment = (skills, keywords) => {
  if (!skills || Object.keys(skills).length === 0) {
    return { score: 0, feedback: 'No skills section found' };
  }
  
  const allSkills = [
    ...(skills.technical || []),
    ...(skills.soft || []),
    ...(skills.languages || [])
  ].map(skill => skill.toLowerCase());
  
  if (allSkills.length === 0) {
    return { score: 0, feedback: 'No skills listed' };
  }
  
  const skillKeywords = keywords.filter(k => 
    (typeof k === 'object' && ['technical', 'soft'].includes(k.category)) ||
    (typeof k === 'string' && (isTechnicalKeyword(k) || isSoftSkill(k)))
  );
  
  let matchedSkills = 0;
  let totalImportance = 0;
  let matchedImportance = 0;
  
  skillKeywords.forEach(keyword => {
    const term = typeof keyword === 'string' ? keyword : keyword.term;
    const importance = typeof keyword === 'object' ? keyword.importance : 50;
    
    totalImportance += importance;
    
    if (allSkills.some(skill => skill.includes(term.toLowerCase()) || term.toLowerCase().includes(skill))) {
      matchedSkills++;
      matchedImportance += importance;
    }
  });
  
  const score = totalImportance > 0 ? Math.round((matchedImportance / totalImportance) * 100) : 0;
  
  return {
    score: Math.min(100, Math.max(0, score)),
    feedback: `${matchedSkills}/${skillKeywords.length} required skills matched`
  };
};

// Calculate education match score
const calculateEducationMatch = (education, keywords) => {
  if (!education || education.length === 0) {
    return { score: 50, feedback: 'No education information found' }; // Neutral score
  }
  
  const educationKeywords = keywords.filter(k => 
    (typeof k === 'object' && k.category === 'qualification') ||
    (typeof k === 'string' && isEducationKeyword(k))
  );
  
  if (educationKeywords.length === 0) {
    return { score: 80, feedback: 'No specific education requirements' };
  }
  
  let score = 60; // Base score for having education
  
  education.forEach(edu => {
    const eduText = `${edu.degree || ''} ${edu.field || ''} ${edu.institution || ''}`.toLowerCase();
    
    educationKeywords.forEach(keyword => {
      const term = typeof keyword === 'string' ? keyword : keyword.term;
      if (eduText.includes(term.toLowerCase())) {
        score += 20; // Bonus for matching education requirement
      }
    });
  });
  
  return {
    score: Math.min(100, Math.max(0, score)),
    feedback: `Education requirements analyzed`
  };
};

// Generate improvement suggestions
const generateImprovementSuggestions = (keywordScore, experienceScore, skillsScore, educationScore) => {
  const suggestions = [];
  
  if (keywordScore.score < 70) {
    suggestions.push({
      category: 'Keywords',
      priority: 'high',
      suggestion: `Add ${keywordScore.missing.length} missing keywords to your resume`,
      details: keywordScore.missing.slice(0, 5).map(k => k.term)
    });
  }
  
  if (experienceScore.score < 60) {
    suggestions.push({
      category: 'Experience',
      priority: 'high',
      suggestion: 'Highlight more relevant experience and achievements',
      details: ['Use specific metrics and numbers', 'Focus on recent relevant roles']
    });
  }
  
  if (skillsScore.score < 70) {
    suggestions.push({
      category: 'Skills',
      priority: 'medium',
      suggestion: 'Add more relevant technical and soft skills',
      details: ['Include industry-specific tools', 'Add certifications if available']
    });
  }
  
  if (educationScore.score < 60) {
    suggestions.push({
      category: 'Education',
      priority: 'low',
      suggestion: 'Consider adding relevant courses or certifications',
      details: ['Online courses', 'Professional certifications', 'Relevant training']
    });
  }
  
  return suggestions;
};

// Helper functions
const getSynonyms = (term) => {
  const synonymMap = {
    'javascript': ['js', 'ecmascript', 'node.js', 'nodejs'],
    'python': ['py', 'python3'],
    'react': ['reactjs', 'react.js'],
    'angular': ['angularjs', 'angular.js'],
    'machine learning': ['ml', 'artificial intelligence', 'ai'],
    'database': ['db', 'databases', 'data storage'],
    'api': ['rest api', 'restful', 'web service'],
    'frontend': ['front-end', 'client-side', 'ui'],
    'backend': ['back-end', 'server-side', 'api'],
    'fullstack': ['full-stack', 'full stack']
  };
  
  return synonymMap[term] || [];
};

const isTechnicalKeyword = (keyword) => {
  const technicalTerms = [
    'javascript', 'python', 'java', 'react', 'angular', 'node.js', 'sql',
    'aws', 'docker', 'kubernetes', 'git', 'html', 'css', 'api', 'database'
  ];
  return technicalTerms.some(term => keyword.toLowerCase().includes(term));
};

const isSoftSkill = (keyword) => {
  const softSkills = [
    'communication', 'leadership', 'teamwork', 'problem solving',
    'analytical', 'creative', 'organized', 'detail-oriented'
  ];
  return softSkills.some(skill => keyword.toLowerCase().includes(skill));
};

const isEducationKeyword = (keyword) => {
  const educationTerms = [
    'bachelor', 'master', 'phd', 'degree', 'university', 'college',
    'certification', 'diploma'
  ];
  return educationTerms.some(term => keyword.toLowerCase().includes(term));
};

const generateKeywordSuggestions = (keyword) => {
  return [
    `Add "${keyword}" to your skills section`,
    `Mention "${keyword}" in relevant work experience`,
    `Include "${keyword}" in project descriptions`
  ];
};

module.exports = {
  calculateResumeMatchScore,
  calculateKeywordMatch,
  calculateExperienceRelevance,
  calculateSkillsAlignment,
  calculateEducationMatch,
  extractAllText
};