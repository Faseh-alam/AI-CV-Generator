const { parentPort, workerData } = require('worker_threads');
const { optimizeResumeWithClaude } = require('../utils/claudeAI');
const { calculateResumeMatchScore } = require('../utils/matchScoreCalculator');
const { parseResumeFile } = require('../utils/resumeParser');
const logger = require('../utils/logger');

// Worker process for CPU-intensive tasks
class OptimizationWorker {
  constructor() {
    this.isProcessing = false;
    this.setupMessageHandlers();
  }

  setupMessageHandlers() {
    if (!parentPort) {
      throw new Error('This script must be run as a worker thread');
    }

    parentPort.on('message', async (message) => {
      if (this.isProcessing) {
        parentPort.postMessage({
          type: 'ERROR',
          error: 'Worker is busy processing another task'
        });
        return;
      }

      try {
        this.isProcessing = true;
        await this.handleMessage(message);
      } catch (error) {
        parentPort.postMessage({
          type: 'ERROR',
          error: error.message,
          stack: error.stack
        });
      } finally {
        this.isProcessing = false;
      }
    });

    // Handle worker termination gracefully
    process.on('SIGTERM', () => {
      logger.info('Optimization worker received SIGTERM, shutting down gracefully');
      process.exit(0);
    });

    process.on('SIGINT', () => {
      logger.info('Optimization worker received SIGINT, shutting down gracefully');
      process.exit(0);
    });
  }

  async handleMessage(message) {
    const startTime = Date.now();

    switch (message.type) {
      case 'OPTIMIZE_RESUME':
        await this.optimizeResume(message);
        break;

      case 'CALCULATE_MATCH_SCORE':
        await this.calculateMatchScore(message);
        break;

      case 'PARSE_RESUME':
        await this.parseResume(message);
        break;

      case 'BULK_OPTIMIZE':
        await this.bulkOptimize(message);
        break;

      default:
        throw new Error(`Unknown message type: ${message.type}`);
    }

    const processingTime = Date.now() - startTime;
    logger.info('Worker task completed', {
      type: message.type,
      processingTime,
      workerId: process.pid
    });
  }

  async optimizeResume(message) {
    const { resumeData, jobKeywords, level, optimizationId } = message.data;

    try {
      // Send progress update
      parentPort.postMessage({
        type: 'PROGRESS',
        optimizationId,
        progress: 10,
        message: 'Starting optimization...'
      });

      // Calculate original match score
      const originalScore = await calculateResumeMatchScore(resumeData, jobKeywords);

      parentPort.postMessage({
        type: 'PROGRESS',
        optimizationId,
        progress: 30,
        message: 'Analyzing resume content...'
      });

      // Optimize with Claude AI
      const optimizationResult = await optimizeResumeWithClaude(
        resumeData,
        jobKeywords,
        level
      );

      parentPort.postMessage({
        type: 'PROGRESS',
        optimizationId,
        progress: 70,
        message: 'Calculating optimized score...'
      });

      // Calculate optimized match score
      const optimizedScore = await calculateResumeMatchScore(
        optimizationResult.optimizedContent,
        jobKeywords
      );

      parentPort.postMessage({
        type: 'PROGRESS',
        optimizationId,
        progress: 90,
        message: 'Finalizing optimization...'
      });

      const result = {
        optimizationId,
        originalScore: originalScore.overallScore,
        optimizedScore: optimizedScore.overallScore,
        improvement: optimizedScore.overallScore - originalScore.overallScore,
        optimizedContent: optimizationResult.optimizedContent,
        changes: optimizationResult.changes,
        keywordCoverage: optimizationResult.keywordCoverage,
        detailedScores: {
          original: originalScore,
          optimized: optimizedScore
        }
      };

      parentPort.postMessage({
        type: 'SUCCESS',
        data: result
      });

    } catch (error) {
      logger.error('Resume optimization failed in worker', {
        optimizationId,
        error: error.message
      });

      parentPort.postMessage({
        type: 'ERROR',
        optimizationId,
        error: error.message
      });
    }
  }

  async calculateMatchScore(message) {
    const { resumeData, jobKeywords, requestId } = message.data;

    try {
      const matchScore = await calculateResumeMatchScore(resumeData, jobKeywords);

      parentPort.postMessage({
        type: 'SUCCESS',
        data: {
          requestId,
          matchScore
        }
      });

    } catch (error) {
      logger.error('Match score calculation failed in worker', {
        requestId,
        error: error.message
      });

      parentPort.postMessage({
        type: 'ERROR',
        requestId,
        error: error.message
      });
    }
  }

  async parseResume(message) {
    const { fileBuffer, mimetype, originalname, requestId } = message.data;

    try {
      // Send progress update
      parentPort.postMessage({
        type: 'PROGRESS',
        requestId,
        progress: 20,
        message: 'Starting resume parsing...'
      });

      const file = {
        buffer: Buffer.from(fileBuffer),
        mimetype,
        originalname
      };

      const parsedData = await parseResumeFile(file);

      parentPort.postMessage({
        type: 'PROGRESS',
        requestId,
        progress: 80,
        message: 'Extracting structured data...'
      });

      parentPort.postMessage({
        type: 'SUCCESS',
        data: {
          requestId,
          parsedData
        }
      });

    } catch (error) {
      logger.error('Resume parsing failed in worker', {
        requestId,
        error: error.message
      });

      parentPort.postMessage({
        type: 'ERROR',
        requestId,
        error: error.message
      });
    }
  }

  async bulkOptimize(message) {
    const { optimizations, requestId } = message.data;
    const results = [];
    const total = optimizations.length;

    try {
      for (let i = 0; i < optimizations.length; i++) {
        const optimization = optimizations[i];
        
        parentPort.postMessage({
          type: 'PROGRESS',
          requestId,
          progress: Math.round((i / total) * 100),
          message: `Processing optimization ${i + 1} of ${total}...`
        });

        try {
          const result = await this.processSingleOptimization(optimization);
          results.push({
            id: optimization.id,
            success: true,
            result
          });
        } catch (error) {
          results.push({
            id: optimization.id,
            success: false,
            error: error.message
          });
        }
      }

      parentPort.postMessage({
        type: 'SUCCESS',
        data: {
          requestId,
          results,
          summary: {
            total,
            successful: results.filter(r => r.success).length,
            failed: results.filter(r => !r.success).length
          }
        }
      });

    } catch (error) {
      logger.error('Bulk optimization failed in worker', {
        requestId,
        error: error.message
      });

      parentPort.postMessage({
        type: 'ERROR',
        requestId,
        error: error.message
      });
    }
  }

  async processSingleOptimization(optimization) {
    const { resumeData, jobKeywords, level } = optimization;

    const originalScore = await calculateResumeMatchScore(resumeData, jobKeywords);
    const optimizationResult = await optimizeResumeWithClaude(resumeData, jobKeywords, level);
    const optimizedScore = await calculateResumeMatchScore(
      optimizationResult.optimizedContent,
      jobKeywords
    );

    return {
      originalScore: originalScore.overallScore,
      optimizedScore: optimizedScore.overallScore,
      improvement: optimizedScore.overallScore - originalScore.overallScore,
      optimizedContent: optimizationResult.optimizedContent,
      changes: optimizationResult.changes
    };
  }
}

// Initialize worker
const worker = new OptimizationWorker();

// Send ready signal to parent
parentPort.postMessage({
  type: 'READY',
  workerId: process.pid
});

logger.info('Optimization worker initialized', { workerId: process.pid });