const express = require('express');
const {
  analyzeJobDescription,
  getJobAnalyses,
  getJobAnalysis,
  updateJobAnalysis,
  deleteJobAnalysis,
  classifyJob,
  extractKeywords
} = require('../controllers/jobController');
const { protect } = require('../middleware/auth');

const router = express.Router();

// Apply authentication to all routes
router.use(protect);

// Job analysis CRUD operations
router.route('/')
  .get(getJobAnalyses)
  .post(analyzeJobDescription);

router.route('/:id')
  .get(getJobAnalysis)
  .put(updateJobAnalysis)
  .delete(deleteJobAnalysis);

// Job-specific operations
router.post('/classify', classifyJob);
router.get('/:id/keywords', extractKeywords);

module.exports = router;