const PDFDocument = require('pdfkit');
const logger = require('./logger');

// Generate ATS-compatible PDF from resume data
const generateATSPDF = async (resumeData) => {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: 'A4',
        margins: {
          top: 50,
          bottom: 50,
          left: 50,
          right: 50
        }
      });

      const buffers = [];
      doc.on('data', buffers.push.bind(buffers));
      doc.on('end', () => {
        const pdfBuffer = Buffer.concat(buffers);
        resolve(pdfBuffer);
      });

      // ATS-friendly formatting rules
      const fonts = {
        regular: 'Helvetica',
        bold: 'Helvetica-Bold'
      };

      let yPosition = 50;

      // Header - Contact Information
      if (resumeData.personal) {
        doc.font(fonts.bold).fontSize(18);
        doc.text(resumeData.personal.name || 'Name Not Available', 50, yPosition);
        yPosition += 25;

        doc.font(fonts.regular).fontSize(10);
        const contactInfo = [];
        if (resumeData.personal.email) contactInfo.push(resumeData.personal.email);
        if (resumeData.personal.phone) contactInfo.push(resumeData.personal.phone);
        if (resumeData.personal.linkedin) contactInfo.push(resumeData.personal.linkedin);
        
        if (contactInfo.length > 0) {
          doc.text(contactInfo.join(' | '), 50, yPosition);
          yPosition += 15;
        }

        if (resumeData.personal.address) {
          doc.text(resumeData.personal.address, 50, yPosition);
          yPosition += 15;
        }

        yPosition += 10;
      }

      // Professional Experience Section
      if (resumeData.experience && resumeData.experience.length > 0) {
        doc.font(fonts.bold).fontSize(14);
        doc.text('PROFESSIONAL EXPERIENCE', 50, yPosition);
        yPosition += 20;

        resumeData.experience.forEach(job => {
          // Job title and company
          doc.font(fonts.bold).fontSize(11);
          const jobHeader = `${job.title || 'Position'}${job.company ? ` - ${job.company}` : ''}`;
          doc.text(jobHeader, 50, yPosition);
          
          // Dates
          if (job.startDate || job.endDate) {
            const dates = `${job.startDate || ''} - ${job.endDate || 'Present'}`;
            doc.text(dates, 400, yPosition);
          }
          
          yPosition += 15;

          // Job description and achievements
          doc.font(fonts.regular).fontSize(10);
          
          if (job.description) {
            doc.text(job.description, 50, yPosition, { width: 500 });
            yPosition += doc.heightOfString(job.description, { width: 500 }) + 5;
          }

          if (job.achievements && job.achievements.length > 0) {
            job.achievements.forEach(achievement => {
              doc.text(`• ${achievement}`, 50, yPosition, { width: 500 });
              yPosition += doc.heightOfString(`• ${achievement}`, { width: 500 }) + 3;
            });
          }

          yPosition += 10;

          // Check if we need a new page
          if (yPosition > 700) {
            doc.addPage();
            yPosition = 50;
          }
        });

        yPosition += 10;
      }

      // Education Section
      if (resumeData.education && resumeData.education.length > 0) {
        // Check if we need a new page
        if (yPosition > 650) {
          doc.addPage();
          yPosition = 50;
        }

        doc.font(fonts.bold).fontSize(14);
        doc.text('EDUCATION', 50, yPosition);
        yPosition += 20;

        resumeData.education.forEach(edu => {
          doc.font(fonts.bold).fontSize(11);
          const eduHeader = `${edu.degree || 'Degree'}${edu.field ? ` in ${edu.field}` : ''}`;
          doc.text(eduHeader, 50, yPosition);
          
          if (edu.graduationDate) {
            doc.text(edu.graduationDate, 400, yPosition);
          }
          
          yPosition += 15;

          if (edu.institution) {
            doc.font(fonts.regular).fontSize(10);
            doc.text(edu.institution, 50, yPosition);
            yPosition += 12;
          }

          if (edu.gpa) {
            doc.font(fonts.regular).fontSize(10);
            doc.text(`GPA: ${edu.gpa}`, 50, yPosition);
            yPosition += 12;
          }

          yPosition += 8;
        });

        yPosition += 10;
      }

      // Skills Section
      if (resumeData.skills && resumeData.skills.technical && resumeData.skills.technical.length > 0) {
        // Check if we need a new page
        if (yPosition > 650) {
          doc.addPage();
          yPosition = 50;
        }

        doc.font(fonts.bold).fontSize(14);
        doc.text('TECHNICAL SKILLS', 50, yPosition);
        yPosition += 20;

        doc.font(fonts.regular).fontSize(10);
        const skillsText = resumeData.skills.technical.join(', ');
        doc.text(skillsText, 50, yPosition, { width: 500 });
        yPosition += doc.heightOfString(skillsText, { width: 500 }) + 15;
      }

      // Certifications Section
      if (resumeData.certifications && resumeData.certifications.length > 0) {
        // Check if we need a new page
        if (yPosition > 650) {
          doc.addPage();
          yPosition = 50;
        }

        doc.font(fonts.bold).fontSize(14);
        doc.text('CERTIFICATIONS', 50, yPosition);
        yPosition += 20;

        resumeData.certifications.forEach(cert => {
          doc.font(fonts.bold).fontSize(10);
          doc.text(cert.name || 'Certification', 50, yPosition);
          
          if (cert.date) {
            doc.text(cert.date, 400, yPosition);
          }
          
          yPosition += 12;

          if (cert.issuer) {
            doc.font(fonts.regular).fontSize(9);
            doc.text(cert.issuer, 50, yPosition);
            yPosition += 10;
          }

          yPosition += 5;
        });
      }

      // Finalize PDF
      doc.end();

    } catch (error) {
      logger.error('PDF generation error:', error);
      reject(new Error(`PDF generation failed: ${error.message}`));
    }
  });
};

// Validate ATS compatibility
const validateATSCompatibility = (resumeData) => {
  const issues = [];
  
  // Check for required sections
  if (!resumeData.personal || !resumeData.personal.name) {
    issues.push('Missing personal information');
  }
  
  if (!resumeData.experience || resumeData.experience.length === 0) {
    issues.push('Missing work experience');
  }
  
  if (!resumeData.skills || !resumeData.skills.technical || resumeData.skills.technical.length === 0) {
    issues.push('Missing technical skills');
  }
  
  // Check for contact information
  if (!resumeData.personal.email) {
    issues.push('Missing email address');
  }
  
  if (!resumeData.personal.phone) {
    issues.push('Missing phone number');
  }
  
  return {
    isValid: issues.length === 0,
    issues
  };
};

// Format date for ATS compatibility
const formatDate = (dateString) => {
  if (!dateString) return '';
  
  try {
    const date = new Date(dateString);
    const month = date.toLocaleString('default', { month: 'short' });
    const year = date.getFullYear();
    return `${month} ${year}`;
  } catch (error) {
    return dateString; // Return original if parsing fails
  }
};

// Clean text for ATS compatibility
const cleanTextForATS = (text) => {
  if (!text) return '';
  
  return text
    .replace(/[^\x00-\x7F]/g, '') // Remove non-ASCII characters
    .replace(/\s+/g, ' ') // Normalize whitespace
    .trim();
};

module.exports = {
  generateATSPDF,
  validateATSCompatibility,
  formatDate,
  cleanTextForATS
};