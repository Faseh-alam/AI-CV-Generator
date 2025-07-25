const { parentPort } = require('worker_threads');
const { optimizeResumeWithClaude } = require('../claudeAI');
const { calculateResumeMatchScore } = require('../matchScoreCalculator');

class OptimizationWorker {
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

  async processOptimization(data) {
    const { optimizationId, resumeData, jobKeywords, optimizationLevel, userId } = data;
    
    try {
      this.currentTask = optimizationId;
      
      // Send progress update
      this.sendProgress(optimizationId, 10, 'Starting optimization...');
      
      // Optimize resume with Claude AI
      this.sendProgress(optimizationId, 30, 'Analyzing resume content...');
      const optimizationResult = await optimizeResumeWithClaude(
        resumeData, 
        jobKeywords, 
        optimizationLevel
      );
      
      // Send progress update
      this.sendProgress(optimizationId, 70, 'Calculating match score...');
      
      // Calculate optimized match score
      const optimizedMatchScore = await calculateResumeMatchScore(
        optimizationResult.optimizedContent, 
        jobKeywords
      );
      
      // Send progress update
      this.sendProgress(optimizationId, 90, 'Finalizing optimization...');
      
      // Prepare result
      const result = {
        optimizationId,
        optimizedContent: optimizationResult.optimizedContent,
        optimizedMatchScore: optimizedMatchScore.overallScore,
        changes: optimizationResult.changes,
        keywordCoverage: optimizationResult.keywordCoverage,
        processingTime: Date.now() - this.startTime
      };
      
      // Send success
      parentPort.postMessage({
        type: 'SUCCESS',
        optimizationId,
        data: result
      });
      
      this.currentTask = null;
      
    } catch (error) {
      // Send error
      parentPort.postMessage({
        type: 'ERROR',
        optimizationId,
        error: error.message
      });
      
      this.currentTask = null;
    }
  }

  async processMatchScore(data) {
    const { requestId, resumeData, jobKeywords } = data;
    
    try {
      this.currentTask = requestId;
      
      // Send progress update
      this.sendProgress(requestId, 50, 'Calculating match score...');
      
      // Calculate match score
      const matchScore = await calculateResumeMatchScore(resumeData, jobKeywords);
      
      // Send success
      parentPort.postMessage({
        type: 'SUCCESS',
        requestId,
        data: matchScore
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
      optimizationId: taskId,
      requestId: taskId,
      progress,
      message
    });
  }

  async handleMessage(message) {
    const { type, data } = message;
    
    this.startTime = Date.now();
    
    switch (type) {
      case 'OPTIMIZE':
        await this.processOptimization(data);
        break;
        
      case 'MATCH_SCORE':
        await this.processMatchScore(data);
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
const worker = new OptimizationWorker();

// Handle messages from main thread
parentPort.on('message', async (message) => {
  await worker.handleMessage(message);
});

// Initialize worker
worker.initialize();