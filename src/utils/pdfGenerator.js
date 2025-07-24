const PDFDocument = require('pdfkit');
const { Worker } = require('worker_threads');
const Bull = require('bull');
const os = require('os');
const logger = require('./logger');

class PDFGenerationService {
  constructor() {
    this.workerPool = [];
    this.queue = new Bull('pdf-generation', {
      redis: process.env.REDIS_URL || 'redis://localhost:6379'
    });
    
    this.initializeWorkers();
    this.setupQueueProcessor();
  }

  initializeWorkers() {
    const workerCount = Math.max(2, Math.floor(os.cpus().length / 2));
    
    for (let i = 0; i < workerCount; i++) {
      const worker = new Worker('./src/utils/workers/pdfWorker.js');
      
      worker.on('error', (error) => {
        logger.error('PDF worker error', { error: error.message });
        this.replaceWorker(worker);
      });
      
      this.workerPool.push({
        worker,
        busy: false
      });
    }
  }

  setupQueueProcessor() {
    this.queue.process('generate-pdf', async (job) => {
      const { resumeId, userId, options } = job.data;
      
      try {
        // Check cache first
        const cached = await this.checkCache(resumeId);
        if (cached) {
          return cached;
        }
        
        // Get resume data (this would come from database)
        const resumeData = job.data.resumeData;
        
        // Generate PDF
        const result = await this.generatePDFAsync(resumeData, options);
        
        // Cache result
        await this.cacheResult(resumeId, result);
        
        // Update job progress
        job.progress(100);
        
        return result;
        
      } catch (error) {
        logger.error('PDF generation failed', {
          jobId: job.id,
          error: error.message
        });
        throw error;
      }
    });
  }

  async generatePDFAsync(resumeData, options) {
    return new Promise((resolve, reject) => {
      // Get available worker
      const workerInfo = this.getAvailableWorker();
      if (!workerInfo) {
        return reject(new Error('No workers available'));
      }
      
      workerInfo.busy = true;
      const { worker } = workerInfo;
      
      // Setup message handlers
      const messageHandler = (message) => {
        switch (message.type) {
          case 'progress':
            // Could emit progress events here
            break;
            
          case 'complete':
            worker.off('message', messageHandler);
            workerInfo.busy = false;
            resolve({
              buffer: Buffer.from(message.data),
              metadata: message.metadata
            });
            break;
            
          case 'error':
            worker.off('message', messageHandler);
            workerInfo.busy = false;
            reject(new Error(message.error));
            break;
        }
      };
      
      worker.on('message', messageHandler);
      
      // Send generation request
      worker.postMessage({
        type: 'generate',
        resumeData,
        options
      });
      
      // Timeout protection
      setTimeout(() => {
        worker.off('message', messageHandler);
        workerInfo.busy = false;
        reject(new Error('PDF generation timeout'));
      }, 30000);
    });
  }

  getAvailableWorker() {
    return this.workerPool.find(w => !w.busy);
  }

  async checkCache(resumeId) {
    // Implementation would check Redis cache
    return null;
  }

  async cacheResult(resumeId, result) {
    // Implementation would cache in Redis
  }

  replaceWorker(failedWorker) {
    const index = this.workerPool.findIndex(w => w.worker === failedWorker);
    if (index !== -1) {
      failedWorker.terminate();
      
      const newWorker = new Worker('./src/utils/workers/pdfWorker.js');
      newWorker.on('error', (error) => {
        logger.error('PDF worker error', { error: error.message });
        this.replaceWorker(newWorker);
      });
      
      this.workerPool[index] = {
        worker: newWorker,
        busy: false
      };
    }
  }
}

// Create singleton instance
const pdfGenerationService = new PDFGenerationService();

// Generate ATS-compatible PDF from resume data
const generateATSPDF = async (resumeData, options = {}) => {
  try {
    // Add job to queue
    const job = await pdfGenerationService.queue.add('generate-pdf', {
      resumeData,
      options,
      resumeId: options.resumeId || 'temp',
      userId: options.userId || 'anonymous'
    });
    
    // Wait for completion
    const result = await job.finished();
    return result.buffer;
    
  } catch (error) {
    logger.error('PDF generation error:', error);
    throw new Error(`PDF generation failed: ${error.message}`);
  }
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