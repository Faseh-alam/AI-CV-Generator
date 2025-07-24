const TokenService = require('../services/tokenService');

const tokenService = new TokenService();
const { getDB } = require('../config/database');
const logger = require('../utils/logger');

const protect = async (req, res, next) => {
  try {
    let token;

    // Get token from header
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    }

    // Make sure token exists
    if (!token) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'NO_TOKEN',
          message: 'Access token required'
        }
      });
    }

    try {
      // Verify token using token service
      const decoded = await tokenService.verifyAccessToken(token);

      // Get user from database
      const db = getDB();
      const result = await db.query(
        'SELECT id, email, first_name, last_name, subscription_tier, subscription_status FROM users WHERE id = $1',
        [decoded.userId]
      );

      if (result.rows.length === 0) {
        return res.status(401).json({
          success: false,
          error: {
            code: 'USER_NOT_FOUND',
            message: 'User not found'
          }
        });
      }

      req.user = result.rows[0];
      req.tokenId = decoded.tokenId;
      next();
    } catch (error) {
      logger.error('Token verification failed:', error);
      
      let errorCode = 'INVALID_TOKEN';
      let message = 'Invalid or expired token';
      
      if (error.message.includes('revoked')) {
        errorCode = 'TOKEN_REVOKED';
        message = 'Token has been revoked';
      } else if (error.message.includes('expired')) {
        errorCode = 'TOKEN_EXPIRED';
        message = 'Token has expired';
      }
      
      return res.status(401).json({
        success: false,
        error: {
          code: errorCode,
          message
        }
      });
    }
  } catch (error) {
    logger.error('Auth middleware error:', error);
    return res.status(500).json({
      success: false,
      error: {
        code: 'AUTH_ERROR',
        message: 'Authentication error'
      }
    });
  }
};

// Check subscription tier
const checkSubscription = (requiredTier = 'free') => {
  return (req, res, next) => {
    const tierLevels = {
      'free': 0,
      'basic': 1,
      'premium': 2
    };

    const userTierLevel = tierLevels[req.user.subscription_tier] || 0;
    const requiredTierLevel = tierLevels[requiredTier] || 0;

    if (userTierLevel < requiredTierLevel) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'SUBSCRIPTION_REQUIRED',
          message: `This feature requires ${requiredTier} subscription or higher`
        }
      });
    }

    next();
  };
};

module.exports = {
  protect,
  checkSubscription
};