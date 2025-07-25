const { parentPort } = require('worker_threads');
const { parseResumeFile } = require('../resumeParser');

class ResumeWorker {
  constructor() {
    this.isReady = false;
    this.currentTask = null;
  }

  async initialize() {
    try {
      // Initialize any required services
      this.isReady = true;
      
      // Signal that worker is ready
      parentPort.postMessage({
        type: 'READY',
        workerId: process.pid
      });
      
    } catch (error) {
      parentPort.postMessage({
        type: 'ERROR',
        error: error.message
      });
    }
  }

  async parseResume(data) {
    const { requestId, fileBuffer, mimeType, originalName } = data;
    
    try {
      this.currentTask = requestId;
      
      // Send progress update
      this.sendProgress(requestId, 20, 'Starting resume parsing...');
      
      // Create file object for parser
      const file = {
        buffer: Buffer.from(fileBuffer),
        mimetype: mimeType,
        originalname: originalName
      };
      
      // Send progress update
      this.sendProgress(requestId, 50, 'Extracting text content...');
      
      // Parse resume
      const parsedData = await parseResumeFile(file);
      
      // Send progress update
      this.sendProgress(requestId, 90, 'Finalizing parsing...');
      
      // Send success
      parentPort.postMessage({
        type: 'SUCCESS',
        requestId,
        data: parsedData
      });
      
      this.currentTask = null;
      
    } catch (error) {
      // Send error
      parentPort.postMessage({
        type: 'ERROR',
        requestId,
        error: error.message
      });
      
      this.currentTask = null;
    }
  }

  sendProgress(taskId, progress, message) {
    parentPort.postMessage({
      type: 'PROGRESS',
      requestId: taskId,
      progress,
      message
    });
  }

  async handleMessage(message) {
    const { type, data } = message;
    
    switch (type) {
      case 'PARSE_RESUME':
        await this.parseResume(data);
        break;
        
      default:
        parentPort.postMessage({
          type: 'ERROR',
          error: `Unknown task type: ${type}`
        });
    }
  }
}

// Create worker instance
const worker = new ResumeWorker();

// Handle messages from main thread
parentPort.on('message', async (message) => {
  await worker.handleMessage(message);
});

// Initialize worker
worker.initialize();