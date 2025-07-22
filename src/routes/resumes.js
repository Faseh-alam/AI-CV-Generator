const express = require('express');
const multer = require('multer');
const path = require('path');
const {
  uploadResume,
  getResumes,
  getResume,
  updateResume,
  deleteResume,
  parseResume,
  generatePDF
} = require('../controllers/resumeController');
const { protect } = require('../middleware/auth');
const { uploadLimiter } = require('../middleware/rateLimiter');

const router = express.Router();

// Configure multer for file uploads
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/msword',
      'text/plain'
    ];
    
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only PDF, DOCX, DOC, and TXT files are allowed.'), false);
    }
  }
});

// Apply authentication to all routes
router.use(protect);

// Resume CRUD operations
router.route('/')
  .get(getResumes)
  .post(uploadLimiter, upload.single('resume'), uploadResume);

router.route('/:id')
  .get(getResume)
  .put(updateResume)
  .delete(deleteResume);

// Resume-specific operations
router.post('/:id/parse', parseResume);
router.post('/:id/generate-pdf', generatePDF);

module.exports = router;