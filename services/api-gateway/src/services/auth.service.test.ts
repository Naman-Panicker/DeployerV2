import { describe, it, expect } from 'vitest';
import jwt from 'jsonwebtoken';
import { env } from '@deployer/config';
import {
  hashPassword,
  comparePassword,
  generateToken,
  verifyToken,
  type TokenPayload,
} from './auth.service.js';

describe('auth.service', () => {
  const samplePayload: TokenPayload = {
    userId: 'usr_test123',
    email: 'tester@deployer.dev',
  };

  describe('JWT token operations', () => {
    it('generateToken should return a non-empty string', () => {
      const token = generateToken(samplePayload);
      expect(token).toBeTypeOf('string');
      expect(token.length).toBeGreaterThan(0);
    });

    it('verifyToken should decode the payload correctly', () => {
      const token = generateToken(samplePayload);
      const decoded = verifyToken(token);
      expect(decoded.userId).toBe(samplePayload.userId);
      expect(decoded.email).toBe(samplePayload.email);
    });

    it('verifyToken should throw on a tampered token', () => {
      const token = generateToken(samplePayload);
      const tampered = token.slice(0, -4) + 'abcd';
      expect(() => verifyToken(tampered)).toThrow();
    });

    it('verifyToken should throw on an expired token', () => {
      // Create a token expired 10 seconds ago
      const expiredToken = jwt.sign(samplePayload, env.JWT_SECRET, {
        expiresIn: '-10s',
      });
      expect(() => verifyToken(expiredToken)).toThrow(/expired/i);
    });
  });

  describe('password operations', () => {
    const password = 'SuperSecretPassword123!';

    it('hashPassword should produce a valid bcrypt hash', async () => {
      const hash = await hashPassword(password);
      expect(hash).toMatch(/^\$2[aby]\$\d{2}\$/);
    });

    it('comparePassword should return true for matching password and hash', async () => {
      const hash = await hashPassword(password);
      const isMatch = await comparePassword(password, hash);
      expect(isMatch).toBe(true);
    });

    it('comparePassword should return false for incorrect password', async () => {
      const hash = await hashPassword(password);
      const isMatch = await comparePassword('WrongPassword', hash);
      expect(isMatch).toBe(false);
    });
  });
});
