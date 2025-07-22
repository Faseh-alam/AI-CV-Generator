const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
const logger = require('./logger');

// Parse resume file based on type
const parseResumeFile = async (file) => {
  try {
    let text = '';
    
    switch (file.mimetype) {
      case 'application/pdf':
        text = await parsePDF(file.buffer);
        break;
      case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
        text = await parseDocx(file.buffer);
        break;
      case 'application/msword':
        text = await parseDoc(file.buffer);
        break;
      case 'text/plain':
        text = file.buffer.toString('utf-8');
        break;
      default:
        throw new Error('Unsupported file type');
    }

    // Extract structured data from text
    const parsedData = await extractStructuredData(text);
    
    return {
      ...parsedData,
      originalText: text,
      accuracy: calculateParsingAccuracy(parsedData)
    };
  } catch (error) {
    logger.error('Resume parsing error:', error);
    throw new Error(`Failed to parse resume: ${error.message}`);
  }
};

// Parse PDF file
const parsePDF = async (buffer) => {
  try {
    const data = await pdfParse(buffer);
    return data.text;
  } catch (error) {
    throw new Error('Failed to parse PDF file');
  }
};

// Parse DOCX file
const parseDocx = async (buffer) => {
  try {
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  } catch (error) {
    throw new Error('Failed to parse DOCX file');
  }
};

// Parse DOC file (legacy Word format)
const parseDoc = async (buffer) => {
  try {
    // For DOC files, we'll use mammoth as well
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  } catch (error) {
    throw new Error('Failed to parse DOC file');
  }
};

// Extract structured data from text
const extractStructuredData = async (text) => {
  const lines = text.split('\n').map(line => line.trim()).filter(line => line.length > 0);
  
  return {
    personal: extractPersonalInfo(text, lines),
    experience: extractExperience(text, lines),
    education: extractEducation(text, lines),
    skills: extractSkills(text, lines),
    certifications: extractCertifications(text, lines)
  };
};

// Extract personal information
const extractPersonalInfo = (text, lines) => {
  const personal = {
    name: '',
    email: '',
    phone: '',
    address: '',
    linkedin: ''
  };

  // Extract email
  const emailRegex = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g;
  const emailMatch = text.match(emailRegex);
  if (emailMatch) {
    personal.email = emailMatch[0];
  }

  // Extract phone
  const phoneRegex = /(\+?1[-.\s]?)?\(?([0-9]{3})\)?[-.\s]?([0-9]{3})[-.\s]?([0-9]{4})/g;
  const phoneMatch = text.match(phoneRegex);
  if (phoneMatch) {
    personal.phone = phoneMatch[0];
  }

  // Extract LinkedIn
  const linkedinRegex = /(linkedin\.com\/in\/[A-Za-z0-9-]+)/g;
  const linkedinMatch = text.match(linkedinRegex);
  if (linkedinMatch) {
    personal.linkedin = `https://${linkedinMatch[0]}`;
  }

  // Extract name (usually the first line or near email)
  if (lines.length > 0) {
    // Try to find name near the top of the document
    for (let i = 0; i < Math.min(5, lines.length); i++) {
      const line = lines[i];
      // Skip lines that look like contact info
      if (!line.includes('@') && !line.match(phoneRegex) && line.length > 5 && line.length < 50) {
        // Check if it looks like a name (2-3 words, proper case)
        const words = line.split(' ').filter(word => word.length > 0);
        if (words.length >= 2 && words.length <= 3) {
          const isName = words.every(word => 
            word.charAt(0).toUpperCase() === word.charAt(0) && 
            word.length > 1
          );
          if (isName) {
            personal.name = line;
            break;
          }
        }
      }
    }
  }

  return personal;
};

// Extract work experience
const extractExperience = (text, lines) => {
  const experience = [];
  const experienceKeywords = ['experience', 'work history', 'employment', 'professional experience'];
  
  let inExperienceSection = false;
  let currentJob = null;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].toLowerCase();
    
    // Check if we're entering experience section
    if (experienceKeywords.some(keyword => line.includes(keyword))) {
      inExperienceSection = true;
      continue;
    }
    
    // Check if we're leaving experience section
    if (inExperienceSection && (line.includes('education') || line.includes('skills'))) {
      inExperienceSection = false;
      if (currentJob) {
        experience.push(currentJob);
        currentJob = null;
      }
      continue;
    }
    
    if (inExperienceSection) {
      const originalLine = lines[i];
      
      // Try to identify job titles and companies
      if (isJobTitle(originalLine)) {
        if (currentJob) {
          experience.push(currentJob);
        }
        
        currentJob = {
          title: '',
          company: '',
          startDate: '',
          endDate: '',
          description: '',
          achievements: []
        };
        
        // Parse job title and company
        const jobInfo = parseJobTitleAndCompany(originalLine);
        currentJob.title = jobInfo.title;
        currentJob.company = jobInfo.company;
        
        // Look for dates in the next few lines
        for (let j = i; j < Math.min(i + 3, lines.length); j++) {
          const dateInfo = extractDates(lines[j]);
          if (dateInfo.startDate) {
            currentJob.startDate = dateInfo.startDate;
            currentJob.endDate = dateInfo.endDate;
            break;
          }
        }
      } else if (currentJob && (originalLine.startsWith('•') || originalLine.startsWith('-'))) {
        // This is likely a bullet point
        currentJob.achievements.push(originalLine.replace(/^[•\-]\s*/, ''));
      }
    }
  }
  
  // Add the last job if exists
  if (currentJob) {
    experience.push(currentJob);
  }
  
  return experience;
};

// Extract education
const extractEducation = (text, lines) => {
  const education = [];
  const educationKeywords = ['education', 'academic background', 'qualifications'];
  
  let inEducationSection = false;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].toLowerCase();
    
    if (educationKeywords.some(keyword => line.includes(keyword))) {
      inEducationSection = true;
      continue;
    }
    
    if (inEducationSection && (line.includes('experience') || line.includes('skills'))) {
      inEducationSection = false;
      continue;
    }
    
    if (inEducationSection) {
      const originalLine = lines[i];
      
      // Look for degree patterns
      const degreeRegex = /(bachelor|master|phd|doctorate|associate|diploma|certificate)/i;
      if (degreeRegex.test(originalLine)) {
        const educationEntry = {
          institution: '',
          degree: '',
          field: '',
          graduationDate: '',
          gpa: null
        };
        
        // Extract degree information
        const degreeInfo = parseDegreeInfo(originalLine);
        Object.assign(educationEntry, degreeInfo);
        
        // Look for graduation date in nearby lines
        for (let j = Math.max(0, i - 1); j < Math.min(i + 2, lines.length); j++) {
          const dateMatch = lines[j].match(/\b(19|20)\d{2}\b/);
          if (dateMatch) {
            educationEntry.graduationDate = dateMatch[0];
            break;
          }
        }
        
        education.push(educationEntry);
      }
    }
  }
  
  return education;
};

// Extract skills
const extractSkills = (text, lines) => {
  const skills = {
    technical: [],
    soft: [],
    languages: []
  };
  
  const skillsKeywords = ['skills', 'technical skills', 'competencies', 'technologies'];
  let inSkillsSection = false;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].toLowerCase();
    
    if (skillsKeywords.some(keyword => line.includes(keyword))) {
      inSkillsSection = true;
      continue;
    }
    
    if (inSkillsSection && (line.includes('experience') || line.includes('education'))) {
      inSkillsSection = false;
      continue;
    }
    
    if (inSkillsSection) {
      const originalLine = lines[i];
      
      // Parse skills from the line
      const lineSkills = parseSkillsFromLine(originalLine);
      skills.technical.push(...lineSkills);
    }
  }
  
  // Remove duplicates
  skills.technical = [...new Set(skills.technical)];
  
  return skills;
};

// Extract certifications
const extractCertifications = (text, lines) => {
  const certifications = [];
  const certKeywords = ['certifications', 'certificates', 'licenses'];
  
  let inCertSection = false;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].toLowerCase();
    
    if (certKeywords.some(keyword => line.includes(keyword))) {
      inCertSection = true;
      continue;
    }
    
    if (inCertSection && (line.includes('experience') || line.includes('education') || line.includes('skills'))) {
      inCertSection = false;
      continue;
    }
    
    if (inCertSection) {
      const originalLine = lines[i];
      
      // Look for certification patterns
      if (originalLine.length > 5 && !originalLine.toLowerCase().includes('certification')) {
        const cert = {
          name: originalLine,
          issuer: '',
          date: '',
          expiryDate: ''
        };
        
        // Try to extract date
        const dateMatch = originalLine.match(/\b(19|20)\d{2}\b/);
        if (dateMatch) {
          cert.date = dateMatch[0];
        }
        
        certifications.push(cert);
      }
    }
  }
  
  return certifications;
};

// Helper functions
const isJobTitle = (line) => {
  // Simple heuristic to identify job titles
  const jobTitleIndicators = ['engineer', 'developer', 'manager', 'analyst', 'specialist', 'coordinator', 'director', 'lead', 'senior', 'junior'];
  return jobTitleIndicators.some(indicator => line.toLowerCase().includes(indicator));
};

const parseJobTitleAndCompany = (line) => {
  // Try to separate job title and company
  const parts = line.split(/\s+at\s+|\s+@\s+|\s+-\s+/i);
  
  if (parts.length >= 2) {
    return {
      title: parts[0].trim(),
      company: parts[1].trim()
    };
  }
  
  return {
    title: line.trim(),
    company: ''
  };
};

const extractDates = (line) => {
  const dateRegex = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{4}\b|\b\d{1,2}\/\d{4}\b|\b\d{4}\b/gi;
  const dates = line.match(dateRegex);
  
  if (dates && dates.length >= 1) {
    return {
      startDate: dates[0],
      endDate: dates[1] || 'Present'
    };
  }
  
  return { startDate: '', endDate: '' };
};

const parseDegreeInfo = (line) => {
  const degreeRegex = /(bachelor|master|phd|doctorate|associate|diploma|certificate)[^,]*/i;
  const degreeMatch = line.match(degreeRegex);
  
  return {
    degree: degreeMatch ? degreeMatch[0] : '',
    institution: line.replace(degreeRegex, '').trim(),
    field: ''
  };
};

const parseSkillsFromLine = (line) => {
  // Split by common delimiters
  const skills = line.split(/[,;|•\-]/)
    .map(skill => skill.trim())
    .filter(skill => skill.length > 1 && skill.length < 30);
  
  return skills;
};

const calculateParsingAccuracy = (parsedData) => {
  let score = 0;
  let maxScore = 0;
  
  // Check personal info
  maxScore += 5;
  if (parsedData.personal.name) score += 1;
  if (parsedData.personal.email) score += 1;
  if (parsedData.personal.phone) score += 1;
  if (parsedData.personal.linkedin) score += 1;
  if (parsedData.personal.address) score += 1;
  
  // Check experience
  maxScore += 3;
  if (parsedData.experience.length > 0) score += 1;
  if (parsedData.experience.some(exp => exp.title)) score += 1;
  if (parsedData.experience.some(exp => exp.company)) score += 1;
  
  // Check education
  maxScore += 2;
  if (parsedData.education.length > 0) score += 1;
  if (parsedData.education.some(edu => edu.degree)) score += 1;
  
  // Check skills
  maxScore += 1;
  if (parsedData.skills.technical.length > 0) score += 1;
  
  return Math.round((score / maxScore) * 100);
};

module.exports = {
  parseResumeFile,
  parsePDF,
  parseDocx,
  parseDoc,
  extractStructuredData
};