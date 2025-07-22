const express = require('express');
const {
  createOptimization,
  getOptimizations,
  getOptimization,
  getOptimizationStatus,
  calculateMatchScore
} = require('../controllers/optimizationController');
const { protect, checkSubscription } = require('../middleware/auth');
const { optimizationLimiter } = require('../middleware/rateLimiter');

const router = express.Router();

// Apply authentication to all routes
router.use(protect);

// Optimization CRUD operations
router.route('/')
  .get(getOptimizations)
  .post(optimizationLimiter, checkSubscription('free'), createOptimization);

router.route('/:id')
  .get(getOptimization);

// Optimization-specific operations
router.get('/:id/status', getOptimizationStatus);
router.post('/match-score', calculateMatchScore);

module.exports = router;