const express = require('express');
const {
  getUserDashboard,
  getUsageStats,
  getOptimizationHistory,
  getApplicationTracking,
  createApplication,
  updateApplication
} = require('../controllers/analyticsController');
const { protect } = require('../middleware/auth');

const router = express.Router();

// Apply authentication to all routes
router.use(protect);

// Analytics endpoints
router.get('/dashboard', getUserDashboard);
router.get('/usage', getUsageStats);
router.get('/optimization-history', getOptimizationHistory);

// Application tracking
router.route('/applications')
  .get(getApplicationTracking)
  .post(createApplication);

router.put('/applications/:id', updateApplication);

module.exports = router;