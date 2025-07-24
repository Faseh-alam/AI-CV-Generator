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
    await this.redis.setex(
      `refresh_family:${tokenId}`,
      604800, // 7 days
      JSON.stringify({ 
        userId, 
        createdAt: Date.now(),
        rotation: 0
      })
    );

    logger.info('Token pair generated', { userId, tokenId });

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
      const newTokenId = crypto.randomBytes(16).toString('hex');
      
      const accessToken = jwt.sign(
        { 
          userId: decoded.userId, 
          type: 'access',
          tokenId: newTokenId 
        },
        this.privateKey,
        { 
          algorithm: this.algorithm,
          expiresIn: '15m',
          issuer: this.issuer,
          audience: this.audience
        }
      );

      const newRefreshToken = jwt.sign(
        { 
          userId: decoded.userId, 
          type: 'refresh',
          tokenId: newTokenId,
          rotation: 0
        },
        this.privateKey,
        { 
          algorithm: this.algorithm,
          expiresIn: '7d',
          issuer: this.issuer
        }
      );

      // Store new token family
      await this.redis.setex(
        `refresh_family:${newTokenId}`,
        604800,
        JSON.stringify({ 
          userId: decoded.userId, 
          createdAt: Date.now(),
          rotation: 0
        })
      );

      logger.info('Tokens refreshed', { userId: decoded.userId, oldTokenId: decoded.tokenId, newTokenId });

      return { accessToken, refreshToken: newRefreshToken, tokenId: newTokenId };
    } catch (error) {
      logger.error('Token refresh failed', { error: error.message });
      throw new Error('Invalid refresh token');
    }
  }

  async blacklistToken(token) {
    try {
      const decoded = jwt.decode(token);
      if (!decoded || !decoded.exp) return;

      const ttl = decoded.exp - Math.floor(Date.now() / 1000);
      if (ttl > 0) {
        await this.redis.setex(`blacklist:${token}`, ttl, '1');
        logger.info('Token blacklisted', { tokenId: decoded.tokenId });
      }
    } catch (error) {
      logger.error('Token blacklist failed', { error: error.message });
    }
  }

  async isTokenBlacklisted(token) {
    try {
      const result = await this.redis.get(`blacklist:${token}`);
      return result === '1';
    } catch (error) {
      logger.error('Blacklist check failed', { error: error.message });
      return false; // Fail open for availability
    }
  }

  async revokeUserTokens(userId) {
    try {
      // Get all token families for user
      const pattern = 'refresh_family:*';
      const keys = await this.redis.keys(pattern);
      
      const pipeline = this.redis.pipeline();
      
      for (const key of keys) {
        const familyData = await this.redis.get(key);
        if (familyData) {
          const family = JSON.parse(familyData);
          if (family.userId === userId) {
            pipeline.del(key);
          }
        }
      }
      
      await pipeline.exec();
      
      logger.info('All user tokens revoked', { userId });
    } catch (error) {
      logger.error('Token revocation failed', { userId, error: error.message });
    }
  }

  async verifyAccessToken(token) {
    try {
      // Check blacklist first
      if (await this.isTokenBlacklisted(token)) {
        throw new Error('Token revoked');
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
      logger.error('Token verification failed', { error: error.message });
      throw error;
    }
  }

  async logout(refreshToken) {
    try {
      const decoded = jwt.decode(refreshToken);
      if (decoded && decoded.tokenId) {
        // Remove token family
        await this.redis.del(`refresh_family:${decoded.tokenId}`);
        
        // Blacklist the refresh token
        await this.blacklistToken(refreshToken);
        
        logger.info('User logged out', { userId: decoded.userId, tokenId: decoded.tokenId });
      }
    } catch (error) {
      logger.error('Logout failed', { error: error.message });
    }
  }

  // Generate RSA key pair for production
  static generateKeyPair() {
    const { generateKeyPairSync } = require('crypto');
    
    const { publicKey, privateKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: {
        type: 'spki',
        format: 'pem'
      },
      privateKeyEncoding: {
        type: 'pkcs8',
        format: 'pem'
      }
    });

    return { publicKey, privateKey };
  }
}

module.exports = TokenService;