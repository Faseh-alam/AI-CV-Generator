const { Worker } = require('worker_threads');
const os = require('os');
const path = require('path');
const EventEmitter = require('events');
const logger = require('../utils/logger');

class WorkerPool extends EventEmitter {
  constructor(workerScript, options = {}) {
    super();
    
    this.workerScript = path.resolve(workerScript);
    this.poolSize = options.poolSize || Math.max(2, os.cpus().length - 1);
    this.maxQueueSize = options.maxQueueSize || 1000;
    this.workerTimeout = options.workerTimeout || 300000; // 5 minutes
    
    this.workers = [];
    this.freeWorkers = [];
    this.busyWorkers = new Set();
    this.queue = [];
    this.taskMap = new Map(); // Track active tasks
    
    this.stats = {
      tasksCompleted: 0,
      tasksErrored: 0,
      totalProcessingTime: 0,
      workersCreated: 0,
      workersTerminated: 0
    };

    this.initialize();
  }

  initialize() {
    logger.info('Initializing worker pool', {
      workerScript: this.workerScript,
      poolSize: this.poolSize,
      maxQueueSize: this.maxQueueSize
    });

    // Create initial workers
    for (let i = 0; i < this.poolSize; i++) {
      this.createWorker();
    }

    // Start health check interval
    this.healthCheckInterval = setInterval(() => {
      this.performHealthCheck();
    }, 30000); // Every 30 seconds

    // Start metrics reporting
    this.metricsInterval = setInterval(() => {
      this.reportMetrics();
    }, 60000); // Every minute
  }

  createWorker() {
    const worker = new Worker(this.workerScript);
    const workerId = worker.threadId;
    
    worker.workerId = workerId;
    worker.createdAt = Date.now();
    worker.tasksProcessed = 0;
    worker.isReady = false;
    worker.currentTask = null;

    // Set up worker event handlers
    worker.on('message', (message) => {
      this.handleWorkerMessage(worker, message);
    });

    worker.on('error', (error) => {
      logger.error('Worker error', {
        workerId,
        error: error.message,
        stack: error.stack
      });
      
      this.handleWorkerError(worker, error);
    });

    worker.on('exit', (code) => {
      logger.info('Worker exited', { workerId, code });
      this.handleWorkerExit(worker, code);
    });

    // Set worker timeout
    worker.timeout = setTimeout(() => {
      logger.warn('Worker timeout, terminating', { workerId });
      this.terminateWorker(worker);
    }, this.workerTimeout);

    this.workers.push(worker);
    this.stats.workersCreated++;

    logger.info('Worker created', { workerId });
    return worker;
  }

  handleWorkerMessage(worker, message) {
    const { type, data, error, optimizationId, requestId } = message;

    switch (type) {
      case 'READY':
        worker.isReady = true;
        this.freeWorkers.push(worker);
        this.processQueue();
        logger.info('Worker ready', { workerId: worker.workerId });
        break;

      case 'SUCCESS':
        this.handleTaskSuccess(worker, data, optimizationId || requestId);
        break;

      case 'ERROR':
        this.handleTaskError(worker, error, optimizationId || requestId);
        break;

      case 'PROGRESS':
        this.handleTaskProgress(worker, message);
        break;

      default:
        logger.warn('Unknown message type from worker', {
          workerId: worker.workerId,
          type
        });
    }
  }

  handleTaskSuccess(worker, result, taskId) {
    const task = this.taskMap.get(taskId);
    if (!task) {
      logger.warn('Received success for unknown task', { taskId });
      return;
    }

    const processingTime = Date.now() - task.startTime;
    
    // Update stats
    this.stats.tasksCompleted++;
    this.stats.totalProcessingTime += processingTime;
    worker.tasksProcessed++;

    // Clear timeout
    if (task.timeout) {
      clearTimeout(task.timeout);
    }

    // Resolve promise
    task.resolve(result);

    // Clean up
    this.taskMap.delete(taskId);
    this.releaseWorker(worker);

    logger.info('Task completed successfully', {
      taskId,
      workerId: worker.workerId,
      processingTime
    });
  }

  handleTaskError(worker, error, taskId) {
    const task = this.taskMap.get(taskId);
    if (!task) {
      logger.warn('Received error for unknown task', { taskId, error });
      return;
    }

    // Update stats
    this.stats.tasksErrored++;

    // Clear timeout
    if (task.timeout) {
      clearTimeout(task.timeout);
    }

    // Reject promise
    task.reject(new Error(error));

    // Clean up
    this.taskMap.delete(taskId);
    this.releaseWorker(worker);

    logger.error('Task failed', {
      taskId,
      workerId: worker.workerId,
      error
    });
  }

  handleTaskProgress(worker, message) {
    const { optimizationId, requestId, progress, message: progressMessage } = message;
    const taskId = optimizationId || requestId;
    
    const task = this.taskMap.get(taskId);
    if (task && task.onProgress) {
      task.onProgress({
        progress,
        message: progressMessage,
        workerId: worker.workerId
      });
    }

    this.emit('progress', {
      taskId,
      progress,
      message: progressMessage,
      workerId: worker.workerId
    });
  }

  handleWorkerError(worker, error) {
    // Remove worker from free workers if present
    const freeIndex = this.freeWorkers.indexOf(worker);
    if (freeIndex !== -1) {
      this.freeWorkers.splice(freeIndex, 1);
    }

    // Fail current task if any
    if (worker.currentTask) {
      const task = this.taskMap.get(worker.currentTask);
      if (task) {
        task.reject(error);
        this.taskMap.delete(worker.currentTask);
      }
    }

    // Terminate and replace worker
    this.terminateWorker(worker);
    this.createWorker();
  }

  handleWorkerExit(worker, code) {
    // Remove from all tracking arrays
    const workerIndex = this.workers.indexOf(worker);
    if (workerIndex !== -1) {
      this.workers.splice(workerIndex, 1);
    }

    const freeIndex = this.freeWorkers.indexOf(worker);
    if (freeIndex !== -1) {
      this.freeWorkers.splice(freeIndex, 1);
    }

    this.busyWorkers.delete(worker);
    this.stats.workersTerminated++;

    // Create replacement worker if pool is running
    if (!this.isShuttingDown) {
      this.createWorker();
    }
  }

  releaseWorker(worker) {
    // Clear worker timeout and reset
    if (worker.timeout) {
      clearTimeout(worker.timeout);
      worker.timeout = setTimeout(() => {
        logger.warn('Worker timeout, terminating', { workerId: worker.workerId });
        this.terminateWorker(worker);
      }, this.workerTimeout);
    }

    worker.currentTask = null;
    this.busyWorkers.delete(worker);
    this.freeWorkers.push(worker);
    
    // Process next task in queue
    this.processQueue();
  }

  async runTask(type, data, options = {}) {
    return new Promise((resolve, reject) => {
      // Check queue size
      if (this.queue.length >= this.maxQueueSize) {
        reject(new Error('Worker pool queue is full'));
        return;
      }

      const taskId = options.taskId || this.generateTaskId();
      const task = {
        id: taskId,
        type,
        data: { ...data, requestId: taskId },
        resolve,
        reject,
        onProgress: options.onProgress,
        priority: options.priority || 0,
        startTime: Date.now(),
        timeout: null
      };

      // Set task timeout
      if (options.timeout) {
        task.timeout = setTimeout(() => {
          this.taskMap.delete(taskId);
          reject(new Error('Task timeout'));
        }, options.timeout);
      }

      this.taskMap.set(taskId, task);

      // Add to queue (with priority sorting)
      this.queue.push(task);
      this.queue.sort((a, b) => b.priority - a.priority);

      // Try to process immediately
      this.processQueue();
    });
  }

  processQueue() {
    while (this.queue.length > 0 && this.freeWorkers.length > 0) {
      const task = this.queue.shift();
      const worker = this.freeWorkers.shift();

      if (!worker.isReady) {
        // Worker not ready, put task back and worker back
        this.queue.unshift(task);
        this.freeWorkers.push(worker);
        break;
      }

      // Assign task to worker
      worker.currentTask = task.id;
      this.busyWorkers.add(worker);

      // Send task to worker
      worker.postMessage({
        type: task.type,
        data: task.data
      });

      logger.info('Task assigned to worker', {
        taskId: task.id,
        workerId: worker.workerId,
        queueLength: this.queue.length
      });
    }
  }

  terminateWorker(worker) {
    // Clear timeout
    if (worker.timeout) {
      clearTimeout(worker.timeout);
    }

    // Terminate worker
    worker.terminate().catch(error => {
      logger.error('Error terminating worker', {
        workerId: worker.workerId,
        error: error.message
      });
    });
  }

  performHealthCheck() {
    const now = Date.now();
    const unhealthyWorkers = [];

    for (const worker of this.workers) {
      // Check if worker has been running too long
      if (now - worker.createdAt > 3600000) { // 1 hour
        unhealthyWorkers.push(worker);
      }

      // Check if worker is stuck
      if (worker.currentTask) {
        const task = this.taskMap.get(worker.currentTask);
        if (task && now - task.startTime > 600000) { // 10 minutes
          unhealthyWorkers.push(worker);
        }
      }
    }

    // Terminate unhealthy workers
    for (const worker of unhealthyWorkers) {
      logger.warn('Terminating unhealthy worker', {
        workerId: worker.workerId,
        age: now - worker.createdAt,
        currentTask: worker.currentTask
      });
      
      this.terminateWorker(worker);
    }
  }

  reportMetrics() {
    const metrics = {
      ...this.stats,
      poolSize: this.workers.length,
      freeWorkers: this.freeWorkers.length,
      busyWorkers: this.busyWorkers.size,
      queueLength: this.queue.length,
      averageProcessingTime: this.stats.tasksCompleted > 0 
        ? Math.round(this.stats.totalProcessingTime / this.stats.tasksCompleted)
        : 0
    };

    logger.info('Worker pool metrics', metrics);
    this.emit('metrics', metrics);
  }

  generateTaskId() {
    return `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  getStats() {
    return {
      ...this.stats,
      poolSize: this.workers.length,
      freeWorkers: this.freeWorkers.length,
      busyWorkers: this.busyWorkers.size,
      queueLength: this.queue.length
    };
  }

  async terminate() {
    this.isShuttingDown = true;

    // Clear intervals
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }
    if (this.metricsInterval) {
      clearInterval(this.metricsInterval);
    }

    // Terminate all workers
    const terminationPromises = this.workers.map(worker => {
      return worker.terminate().catch(error => {
        logger.error('Error terminating worker during shutdown', {
          workerId: worker.workerId,
          error: error.message
        });
      });
    });

    await Promise.all(terminationPromises);

    // Reject all pending tasks
    for (const [taskId, task] of this.taskMap.entries()) {
      task.reject(new Error('Worker pool terminated'));
    }

    this.taskMap.clear();
    this.queue.length = 0;
    this.workers.length = 0;
    this.freeWorkers.length = 0;
    this.busyWorkers.clear();

    logger.info('Worker pool terminated');
  }
}

module.exports = WorkerPool;