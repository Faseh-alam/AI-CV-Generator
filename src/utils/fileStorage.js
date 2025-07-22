const AWS = require('aws-sdk');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const logger = require('./logger');

// Configure AWS
AWS.config.update({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION || 'us-east-1'
});

const s3 = new AWS.S3();
const BUCKET_NAME = process.env.AWS_S3_BUCKET;

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

// Main upload function that chooses between S3 and local storage
const uploadFile = async (buffer, originalFilename, userId) => {
  if (process.env.AWS_S3_BUCKET && process.env.AWS_ACCESS_KEY_ID) {
    return await uploadToS3(buffer, originalFilename, userId);
  } else {
    logger.warn('S3 not configured, using local storage');
    return await uploadToLocal(buffer, originalFilename, userId);
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