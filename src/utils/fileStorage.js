const AWS = require('aws-sdk');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const stream = require('stream');
const { promisify } = require('util');
const pipeline = promisify(stream.pipeline);
const fileType = require('file-type');
const ClamScan = require('clamscan');
const crypto = require('crypto');
const logger = require('./logger');

// Configure AWS
AWS.config.update({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION || 'us-east-1'
});

const s3 = new AWS.S3();
const BUCKET_NAME = process.env.AWS_S3_BUCKET;

class SecureFileService {
  constructor() {
    this.initializeClamAV();
    this.allowedMimeTypes = new Set([
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/msword',
      'text/plain'
    ]);
    
    this.maxFileSize = 10 * 1024 * 1024; // 10MB
  }

  async initializeClamAV() {
    try {
      this.clamScan = await new ClamScan().init({
        clamdscan: {
          host: process.env.CLAMAV_HOST || 'localhost',
          port: process.env.CLAMAV_PORT || 3310,
          timeout: 60000,
          localFallback: true
        },
        preference: 'clamdscan'
      });
    } catch (error) {
      logger.warn('ClamAV not available, virus scanning disabled', { error: error.message });
      this.clamScan = null;
    }
  }

  async secureFileUpload(fileStream, originalName, userId) {
    const uploadId = crypto.randomBytes(16).toString('hex');
    const tempPath = `/tmp/upload_${uploadId}`;
    
    try {
      // Create secure processing pipeline
      const processingPipeline = this.createProcessingPipeline(
        fileStream,
        tempPath,
        originalName
      );
      
      // Execute pipeline with monitoring
      const result = await this.executeSecurePipeline(
        processingPipeline,
        uploadId
      );
      
      // Store in permanent location
      const permanentPath = await this.storeSecurely(
        result.sanitizedBuffer,
        result.metadata,
        userId
      );
      
      return {
        path: permanentPath,
        metadata: result.metadata,
        scanResult: result.scanResult
      };
      
    } catch (error) {
      logger.error('Secure file upload failed', {
        uploadId,
        error: error.message
      });
      
      // Cleanup on failure
      await this.cleanup(tempPath);
      
      throw new FileProcessingError(
        error.userMessage || 'File upload failed',
        error.code || 'UPLOAD_ERROR'
      );
    }
  }

  createProcessingPipeline(inputStream, tempPath, originalName) {
    const stages = [];
    
    // Stage 1: Size limiter
    const sizeLimiter = new SizeLimiterStream(this.maxFileSize);
    stages.push({ name: 'sizeLimiter', stream: sizeLimiter });
    
    // Stage 2: Type validator
    const typeValidator = new TypeValidatorStream(this.allowedMimeTypes);
    stages.push({ name: 'typeValidator', stream: typeValidator });
    
    // Stage 3: Virus scanner (if available)
    if (this.clamScan) {
      const virusScanner = new VirusScannerStream(this.clamScan);
      stages.push({ name: 'virusScanner', stream: virusScanner });
    }
    
    // Stage 4: Content sanitizer
    const sanitizer = new ContentSanitizerStream(originalName);
    stages.push({ name: 'sanitizer', stream: sanitizer });
    
    return {
      input: inputStream,
      stages,
      output: tempPath
    };
  }

  async executeSecurePipeline(pipeline, uploadId) {
    const metrics = {
      startTime: Date.now(),
      uploadId,
      stages: {}
    };
    
    try {
      // Build stream pipeline
      let currentStream = pipeline.input;
      
      for (const stage of pipeline.stages) {
        stage.stream.on('metrics', (data) => {
          metrics.stages[stage.name] = data;
        });
        
        currentStream = currentStream.pipe(stage.stream);
      }
      
      // Execute pipeline
      const outputBuffer = await this.streamToBuffer(currentStream);
      
      metrics.duration = Date.now() - metrics.startTime;
      logger.info('File processing completed', metrics);
      
      return {
        sanitizedBuffer: outputBuffer,
        metadata: this.extractMetadata(metrics),
        scanResult: metrics.stages.virusScanner
      };
      
    } catch (error) {
      metrics.error = error.message;
      logger.error('Pipeline execution failed', metrics);
      throw error;
    }
  }

  async storeSecurely(buffer, metadata, userId) {
    const fileHash = crypto
      .createHash('sha256')
      .update(buffer)
      .digest('hex');
    
    // Check for duplicate files
    const existingFile = await this.checkDuplicate(fileHash, userId);
    if (existingFile) {
      logger.info('Duplicate file detected, returning existing', {
        fileHash,
        userId
      });
      return existingFile.path;
    }
    
    // Generate secure path
    const securePath = this.generateSecurePath(userId, metadata);
    
    // Upload to S3 with server-side encryption
    await s3.upload({
      Bucket: BUCKET_NAME,
      Key: securePath,
      Body: buffer,
      ServerSideEncryption: 'AES256',
      Metadata: {
        ...metadata,
        fileHash,
        uploadTime: new Date().toISOString()
      },
      StorageClass: 'INTELLIGENT_TIERING'
    }).promise();
    
    return securePath;
  }

  generateSecurePath(userId, metadata) {
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const randomId = crypto.randomBytes(16).toString('hex');
    
    // Prevent path traversal
    const sanitizedUserId = userId.replace(/[^a-zA-Z0-9-]/g, '');
    const extension = metadata.extension || '.bin';
    
    return `uploads/${year}/${month}/${sanitizedUserId}/${randomId}${extension}`;
  }

  async streamToBuffer(stream) {
    const chunks = [];
    return new Promise((resolve, reject) => {
      stream.on('data', chunk => chunks.push(chunk));
      stream.on('end', () => resolve(Buffer.concat(chunks)));
      stream.on('error', reject);
    });
  }

  extractMetadata(metrics) {
    return {
      processingTime: metrics.duration,
      stages: Object.keys(metrics.stages),
      uploadId: metrics.uploadId
    };
  }

  async checkDuplicate(fileHash, userId) {
    // Implementation would check database for existing file hash
    // For now, return null (no duplicate)
    return null;
  }

  async cleanup(tempPath) {
    try {
      const fs = require('fs').promises;
      await fs.unlink(tempPath);
    } catch (error) {
      logger.warn('Failed to cleanup temp file', { tempPath, error: error.message });
    }
  }
}

// Custom stream transformers
class SizeLimiterStream extends stream.Transform {
  constructor(maxSize) {
    super();
    this.maxSize = maxSize;
    this.currentSize = 0;
  }

  _transform(chunk, encoding, callback) {
    this.currentSize += chunk.length;
    
    if (this.currentSize > this.maxSize) {
      this.emit('metrics', { 
        rejected: true, 
        size: this.currentSize 
      });
      
      callback(new FileProcessingError(
        'File size exceeds limit',
        'FILE_TOO_LARGE'
      ));
    } else {
      this.push(chunk);
      callback();
    }
  }
}

class TypeValidatorStream extends stream.Transform {
  constructor(allowedTypes) {
    super();
    this.allowedTypes = allowedTypes;
    this.chunks = [];
    this.validated = false;
  }

  async _transform(chunk, encoding, callback) {
    this.chunks.push(chunk);
    
    // Need at least 4KB to determine file type
    if (!this.validated && this.getTotalSize() >= 4096) {
      const buffer = Buffer.concat(this.chunks);
      const type = await fileType.fromBuffer(buffer);
      
      if (!type || !this.allowedTypes.has(type.mime)) {
        this.emit('metrics', { 
          rejected: true, 
          detectedType: type?.mime 
        });
        
        callback(new FileProcessingError(
          'Invalid file type',
          'INVALID_FILE_TYPE'
        ));
        return;
      }
      
      this.validated = true;
      this.emit('metrics', { 
        validated: true, 
        mimeType: type.mime 
      });
    }
    
    this.push(chunk);
    callback();
  }
  
  getTotalSize() {
    return this.chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  }
}

class VirusScannerStream extends stream.Transform {
  constructor(clamScan) {
    super();
    this.clamScan = clamScan;
    this.chunks = [];
  }

  async _transform(chunk, encoding, callback) {
    this.chunks.push(chunk);
    this.push(chunk);
    callback();
  }

  async _flush(callback) {
    try {
      const buffer = Buffer.concat(this.chunks);
      const scanResult = await this.clamScan.scanBuffer(buffer);
      
      if (scanResult.isInfected) {
        this.emit('metrics', { 
          infected: true, 
          virus: scanResult.viruses 
        });
        
        callback(new FileProcessingError(
          'File failed security scan',
          'VIRUS_DETECTED'
        ));
      } else {
        this.emit('metrics', { 
          clean: true 
        });
        callback();
      }
    } catch (error) {
      logger.warn('Virus scan failed', { error: error.message });
      // Continue without virus scan if it fails
      this.emit('metrics', { 
        scanFailed: true 
      });
      callback();
    }
  }
}

class ContentSanitizerStream extends stream.Transform {
  constructor(originalName) {
    super();
    this.originalName = originalName;
  }

  _transform(chunk, encoding, callback) {
    // Basic content sanitization
    // For now, just pass through - could add more sanitization logic
    this.push(chunk);
    callback();
  }
}

class FileProcessingError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
    this.userMessage = message;
    this.isOperational = true;
  }
}

// Create singleton instance
const secureFileService = new SecureFileService();

// Upload file to S3
const uploadToS3 = async (buffer, originalFilename, userId) => {
  try {
    if (!BUCKET_NAME) {
      throw new Error('AWS S3 bucket not configured');
    }

    const fileExtension = path.extname(originalFilename);
    const fileName = `${userId}/${uuidv4()}${fileExtension}`;
    
    const params = {
      Bucket: BUCKET_NAME,
      Key: fileName,
      Body: buffer,
      ContentType: getContentType(fileExtension),
      ServerSideEncryption: 'AES256',
      Metadata: {
        'original-filename': originalFilename,
        'user-id': userId,
        'upload-date': new Date().toISOString()
      }
    };

    const result = await s3.upload(params).promise();
    
    logger.info(`File uploaded to S3: ${fileName}`);
    return result.Location;
  } catch (error) {
    logger.error('S3 upload error:', error);
    throw new Error(`File upload failed: ${error.message}`);
  }
};

// Download file from S3
const downloadFromS3 = async (filePath) => {
  try {
    if (!BUCKET_NAME) {
      throw new Error('AWS S3 bucket not configured');
    }

    const params = {
      Bucket: BUCKET_NAME,
      Key: filePath
    };

    const result = await s3.getObject(params).promise();
    return result.Body;
  } catch (error) {
    logger.error('S3 download error:', error);
    throw new Error(`File download failed: ${error.message}`);
  }
};

// Delete file from S3
const deleteFromS3 = async (filePath) => {
  try {
    if (!BUCKET_NAME) {
      throw new Error('AWS S3 bucket not configured');
    }

    const params = {
      Bucket: BUCKET_NAME,
      Key: filePath
    };

    await s3.deleteObject(params).promise();
    logger.info(`File deleted from S3: ${filePath}`);
  } catch (error) {
    logger.error('S3 delete error:', error);
    throw new Error(`File deletion failed: ${error.message}`);
  }
};

// Generate signed URL for temporary access
const generateSignedUrl = async (filePath, expiresIn = 3600) => {
  try {
    if (!BUCKET_NAME) {
      throw new Error('AWS S3 bucket not configured');
    }

    const params = {
      Bucket: BUCKET_NAME,
      Key: filePath,
      Expires: expiresIn
    };

    const url = await s3.getSignedUrlPromise('getObject', params);
    return url;
  } catch (error) {
    logger.error('S3 signed URL error:', error);
    throw new Error(`Signed URL generation failed: ${error.message}`);
  }
};

// Get content type based on file extension
const getContentType = (extension) => {
  const contentTypes = {
    '.pdf': 'application/pdf',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.doc': 'application/msword',
    '.txt': 'text/plain'
  };

  return contentTypes[extension.toLowerCase()] || 'application/octet-stream';
};

// Check if file exists in S3
const fileExists = async (filePath) => {
  try {
    if (!BUCKET_NAME) {
      return false;
    }

    const params = {
      Bucket: BUCKET_NAME,
      Key: filePath
    };

    await s3.headObject(params).promise();
    return true;
  } catch (error) {
    if (error.code === 'NotFound') {
      return false;
    }
    throw error;
  }
};

// List files for a user
const listUserFiles = async (userId, maxKeys = 100) => {
  try {
    if (!BUCKET_NAME) {
      throw new Error('AWS S3 bucket not configured');
    }

    const params = {
      Bucket: BUCKET_NAME,
      Prefix: `${userId}/`,
      MaxKeys: maxKeys
    };

    const result = await s3.listObjectsV2(params).promise();
    
    return result.Contents.map(obj => ({
      key: obj.Key,
      size: obj.Size,
      lastModified: obj.LastModified,
      etag: obj.ETag
    }));
  } catch (error) {
    logger.error('S3 list files error:', error);
    throw new Error(`Failed to list files: ${error.message}`);
  }
};

// Get file metadata
const getFileMetadata = async (filePath) => {
  try {
    if (!BUCKET_NAME) {
      throw new Error('AWS S3 bucket not configured');
    }

    const params = {
      Bucket: BUCKET_NAME,
      Key: filePath
    };

    const result = await s3.headObject(params).promise();
    
    return {
      contentType: result.ContentType,
      contentLength: result.ContentLength,
      lastModified: result.LastModified,
      etag: result.ETag,
      metadata: result.Metadata
    };
  } catch (error) {
    logger.error('S3 metadata error:', error);
    throw new Error(`Failed to get file metadata: ${error.message}`);
  }
};

// Fallback to local storage if S3 is not configured
const uploadToLocal = async (buffer, originalFilename, userId) => {
  const fs = require('fs').promises;
  const path = require('path');
  
  try {
    const uploadsDir = path.join(__dirname, '../../uploads', userId);
    await fs.mkdir(uploadsDir, { recursive: true });
    
    const fileExtension = path.extname(originalFilename);
    const fileName = `${uuidv4()}${fileExtension}`;
    const filePath = path.join(uploadsDir, fileName);
    
    await fs.writeFile(filePath, buffer);
    
    logger.info(`File uploaded locally: ${filePath}`);
    return `uploads/${userId}/${fileName}`;
  } catch (error) {
    logger.error('Local upload error:', error);
    throw new Error(`Local file upload failed: ${error.message}`);
  }
};

// Main upload function that uses secure processing
const uploadFile = async (fileStream, originalFilename, userId) => {
  if (process.env.AWS_S3_BUCKET && process.env.AWS_ACCESS_KEY_ID) {
    return await secureFileService.secureFileUpload(fileStream, originalFilename, userId);
  } else {
    logger.warn('S3 not configured, using local storage');
    // Convert stream to buffer for local storage
    const chunks = [];
    return new Promise((resolve, reject) => {
      fileStream.on('data', chunk => chunks.push(chunk));
      fileStream.on('end', async () => {
        try {
          const buffer = Buffer.concat(chunks);
          const result = await uploadToLocal(buffer, originalFilename, userId);
          resolve({ path: result, metadata: {}, scanResult: {} });
        } catch (error) {
          reject(error);
        }
      });
      fileStream.on('error', reject);
    });
  }
};

module.exports = {
  uploadToS3,
  downloadFromS3,
  deleteFromS3,
  generateSignedUrl,
  fileExists,
  listUserFiles,
  getFileMetadata,
  uploadFile,
  uploadToLocal
};