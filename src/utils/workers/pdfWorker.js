const { parentPort } = require('worker_threads');
const PDFDocument = require('pdfkit');

class AsyncPDFGenerator {
  constructor() {
    this.progressInterval = null;
  }

  async generatePDF(resumeData, options = {}) {
    const doc = new PDFDocument({
      size: 'A4',
      bufferPages: true,
      margins: options.margins || {
        top: 50,
        bottom: 50,
        left: 50,
        right: 50
      }
    });

    // Track progress
    let progress = 0;
    const totalSections = this.countSections(resumeData);
    
    this.progressInterval = setInterval(() => {
      parentPort.postMessage({
        type: 'progress',
        progress: Math.min(progress / totalSections * 100, 99)
      });
    }, 100);

    try {
      // Generate PDF sections asynchronously
      if (resumeData.personal) {
        await this.generatePersonalSection(doc, resumeData.personal);
        progress++;
      }

      if (resumeData.experience?.length > 0) {
        await this.generateExperienceSection(doc, resumeData.experience);
        progress++;
      }

      if (resumeData.education?.length > 0) {
        await this.generateEducationSection(doc, resumeData.education);
        progress++;
      }

      if (resumeData.skills) {
        await this.generateSkillsSection(doc, resumeData.skills);
        progress++;
      }

      // Optimize for ATS
      this.applyATSOptimizations(doc);

      // Convert to buffer
      const chunks = [];
      doc.on('data', chunk => chunks.push(chunk));
      
      await new Promise((resolve, reject) => {
        doc.on('end', resolve);
        doc.on('error', reject);
        doc.end();
      });

      const pdfBuffer = Buffer.concat(chunks);
      
      // Send completion
      clearInterval(this.progressInterval);
      parentPort.postMessage({
        type: 'complete',
        data: pdfBuffer,
        metadata: {
          pageCount: doc.bufferedPageRange().count,
          size: pdfBuffer.length,
          atsScore: this.calculateATSScore(resumeData)
        }
      });

    } catch (error) {
      clearInterval(this.progressInterval);
      parentPort.postMessage({
        type: 'error',
        error: error.message
      });
    }
  }

  countSections(resumeData) {
    let count = 0;
    if (resumeData.personal) count++;
    if (resumeData.experience?.length > 0) count++;
    if (resumeData.education?.length > 0) count++;
    if (resumeData.skills) count++;
    return Math.max(1, count);
  }

  async generatePersonalSection(doc, personal) {
    doc.fontSize(18).font('Helvetica-Bold');
    doc.text(personal.name || 'Name Not Available', 50, 50);
    
    // Contact info
    const contactY = 75;
    doc.fontSize(10).font('Helvetica');
    
    if (personal.email) {
      doc.text(personal.email, 50, contactY);
    }
    
    if (personal.phone) {
      doc.text(personal.phone, 200, contactY);
    }
    
    if (personal.linkedin) {
      doc.text(personal.linkedin, 350, contactY);
    }
    
    // Add other contact details...
    await this.delay(10); // Yield to event loop
  }

  async generateExperienceSection(doc, experience) {
    doc.addPage();
    doc.fontSize(14).font('Helvetica-Bold');
    doc.text('PROFESSIONAL EXPERIENCE', 50, 50);
    
    let yPosition = 80;
    
    for (const job of experience) {
      // Check page space
      if (yPosition > 700) {
        doc.addPage();
        yPosition = 50;
      }
      
      // Generate job entry
      await this.generateJobEntry(doc, job, yPosition);
      yPosition += this.calculateJobHeight(job);
      
      // Yield to event loop periodically
      await this.delay(5);
    }
  }

  async generateJobEntry(doc, job, yPosition) {
    doc.fontSize(12).font('Helvetica-Bold');
    doc.text(job.title || 'Position', 50, yPosition);
    
    if (job.company) {
      doc.text(job.company, 300, yPosition);
    }
    
    if (job.startDate || job.endDate) {
      const dates = `${job.startDate || ''} - ${job.endDate || 'Present'}`;
      doc.text(dates, 450, yPosition);
    }
    
    yPosition += 15;
    
    if (job.description) {
      doc.fontSize(10).font('Helvetica');
      doc.text(job.description, 50, yPosition, { width: 500 });
      yPosition += doc.heightOfString(job.description, { width: 500 }) + 5;
    }
    
    if (job.achievements && job.achievements.length > 0) {
      job.achievements.forEach(achievement => {
        doc.text(`• ${achievement}`, 50, yPosition, { width: 500 });
        yPosition += doc.heightOfString(`• ${achievement}`, { width: 500 }) + 3;
      });
    }
  }

  calculateJobHeight(job) {
    // Estimate height needed for job entry
    let height = 30; // Base height for title and dates
    
    if (job.description) {
      height += Math.ceil(job.description.length / 80) * 12; // Rough estimate
    }
    
    if (job.achievements) {
      height += job.achievements.length * 15;
    }
    
    return height + 10; // Add padding
  }

  async generateEducationSection(doc, education) {
    if (doc.y > 650) {
      doc.addPage();
    }

    doc.fontSize(14).font('Helvetica-Bold');
    doc.text('EDUCATION', 50, doc.y + 20);
    
    let yPosition = doc.y + 20;

    education.forEach(edu => {
      doc.fontSize(11).font('Helvetica-Bold');
      const eduHeader = `${edu.degree || 'Degree'}${edu.field ? ` in ${edu.field}` : ''}`;
      doc.text(eduHeader, 50, yPosition);
      
      if (edu.graduationDate) {
        doc.text(edu.graduationDate, 400, yPosition);
      }
      
      yPosition += 15;

      if (edu.institution) {
        doc.fontSize(10).font('Helvetica');
        doc.text(edu.institution, 50, yPosition);
        yPosition += 12;
      }

      yPosition += 8;
    });
  }

  async generateSkillsSection(doc, skills) {
    if (doc.y > 650) {
      doc.addPage();
    }

    doc.fontSize(14).font('Helvetica-Bold');
    doc.text('TECHNICAL SKILLS', 50, doc.y + 20);
    
    let yPosition = doc.y + 20;

    if (skills.technical && skills.technical.length > 0) {
      doc.fontSize(10).font('Helvetica');
      const skillsText = skills.technical.join(', ');
      doc.text(skillsText, 50, yPosition, { width: 500 });
    }
  }

  applyATSOptimizations(doc) {
    // Add metadata for ATS parsing
    doc.info.Title = 'Professional Resume';
    doc.info.Author = 'Resume Optimizer';
    doc.info.Subject = 'ATS-Optimized Resume';
    doc.info.Keywords = 'resume, professional, ATS';
    
    // Ensure text is selectable
    doc.options.compress = false;
  }

  calculateATSScore(resumeData) {
    let score = 100;
    
    // Deduct points for missing sections
    if (!resumeData.personal?.email) score -= 10;
    if (!resumeData.personal?.phone) score -= 10;
    if (!resumeData.experience?.length) score -= 20;
    if (!resumeData.skills?.technical?.length) score -= 15;
    
    return Math.max(0, score);
  }

  async delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Worker message handler
parentPort.on('message', async (message) => {
  if (message.type === 'generate') {
    const generator = new AsyncPDFGenerator();
    await generator.generatePDF(message.resumeData, message.options);
  }
});