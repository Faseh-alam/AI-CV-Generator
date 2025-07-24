const fs = require('fs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { getRedis } = require('../config/redis');
const logger = require('../utils/logger');

class TokenService {
  constructor() {
    // Use symmetric key for development, RSA for production
    if (process.env.NODE_ENV === 'production') {
      try {
        this.privateKey = fs.readFileSync('keys/private.key');
        this.publicKey = fs.readFileSync('keys/public.key');
        this.algorithm = 'RS256';
      } catch (error) {
        logger.warn('RSA keys not found, falling back to symmetric key');
        this.privateKey = process.env.JWT_SECRET;
        this.publicKey = process.env.JWT_SECRET;
        this.algorithm = 'HS256';
      }
    } else {
      this.privateKey = process.env.JWT_SECRET;
      this.publicKey = process.env.JWT_SECRET;
      this.algorithm = 'HS256';
    }
    
    this.redis = getRedis();
    this.issuer = 'resume-optimizer';
    this.audience = 'api';
  }

  async generateTokenPair(userId) {
    const tokenId = crypto.randomBytes(16).toString('hex');
    
    // 15-minute access token (industry standard)
    const accessToken = jwt.sign(
      { 
        userId, 
        type: 'access',
        tokenId 
      },
      this.privateKey,
      { 
        algorithm: this.algorithm,
        expiresIn: '15m',
        issuer: this.issuer,
        audience: this.audience
      }
    );

    // 7-day refresh token with rotation tracking
    const refreshToken = jwt.sign(
      { 
        userId, 
        type: 'refresh',
        tokenId,
        rotation: 0
      },
      this.privateKey,
      { 
        algorithm: this.algorithm,
        expiresIn: '7d',
        issuer: this.issuer
      }
    );

    // Store refresh token family for rotation tracking
    try {
      await this.redis.setex(
        `refresh_family:${tokenId}`,
        604800, // 7 days
        JSON.stringify({ 
          userId, 
          createdAt: Date.now(),
          rotation: 0
        })
      );
    } catch (error) {
      logger.error('Failed to store refresh token family:', error);
    }

    return { accessToken, refreshToken, tokenId };
  }

  async refreshTokens(refreshToken) {
    try {
      const decoded = jwt.verify(refreshToken, this.publicKey, {
        algorithms: [this.algorithm],
        issuer: this.issuer
      });
      
      if (decoded.type !== 'refresh') {
        throw new Error('Invalid token type');
      }

      // Check if token family is valid
      const familyData = await this.redis.get(`refresh_family:${decoded.tokenId}`);
      if (!familyData) {
        // Token family revoked - possible token theft
        await this.revokeUserTokens(decoded.userId);
        throw new Error('Token family revoked - possible security breach');
      }

      const family = JSON.parse(familyData);
      
      // Check rotation count to prevent replay attacks
      if (decoded.rotation !== family.rotation) {
        await this.revokeUserTokens(decoded.userId);
        throw new Error('Token rotation mismatch - possible replay attack');
      }

      // Blacklist old refresh token
      await this.blacklistToken(refreshToken);

      // Update rotation count
      family.rotation += 1;
      await this.redis.setex(
        `refresh_family:${decoded.tokenId}`,
        604800,
        JSON.stringify(family)
      );

      // Generate new token pair with incremented rotation
      return this.generateTokenPair(decoded.userId);
    } catch (error) {
      if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
        throw new Error('Invalid or expired refresh token');
      }
      throw error;
    }
  }

  async blacklistToken(token) {
    try {
      const decoded = jwt.decode(token);
      if (!decoded || !decoded.exp) return;

      const ttl = decoded.exp - Math.floor(Date.now() / 1000);
      if (ttl > 0) {
        await this.redis.setex(`blacklist:${token}`, ttl, '1');
      }
    } catch (error) {
      logger.error('Failed to blacklist token:', error);
    }
  }

  async isTokenBlacklisted(token) {
    try {
      const result = await this.redis.get(`blacklist:${token}`);
      return result === '1';
    } catch (error) {
      logger.error('Failed to check token blacklist:', error);
      return false; // Fail open for availability
    }
  }

  async revokeUserTokens(userId) {
    try {
      // Get all token families for user
      const pattern = 'refresh_family:*';
      const keys = await this.redis.keys(pattern);
      
      for (const key of keys) {
        const familyData = await this.redis.get(key);
        if (familyData) {
          const family = JSON.parse(familyData);
          if (family.userId === userId) {
            await this.redis.del(key);
          }
        }
      }

      logger.info(`Revoked all tokens for user ${userId}`);
    } catch (error) {
      logger.error('Failed to revoke user tokens:', error);
    }
  }

  async verifyAccessToken(token) {
    try {
      // Check blacklist first
      if (await this.isTokenBlacklisted(token)) {
        throw new Error('Token has been revoked');
      }

      const decoded = jwt.verify(token, this.publicKey, {
        algorithms: [this.algorithm],
        issuer: this.issuer,
        audience: this.audience
      });

      if (decoded.type !== 'access') {
        throw new Error('Invalid token type');
      }

      return decoded;
    } catch (error) {
      throw error;
    }
  }

  async logout(accessToken, refreshToken) {
    try {
      // Blacklist both tokens
      await Promise.all([
        this.blacklistToken(accessToken),
        this.blacklistToken(refreshToken)
      ]);

      // Remove refresh token family if refresh token provided
      if (refreshToken) {
        const decoded = jwt.decode(refreshToken);
        if (decoded && decoded.tokenId) {
          await this.redis.del(`refresh_family:${decoded.tokenId}`);
        }
      }

      return true;
    } catch (error) {
      logger.error('Logout error:', error);
      return false;
    }
  }
}

module.exports = new TokenService();