import { describe, it, expect } from 'vitest';
import {
  encrypt,
  decrypt,
  encryptEnvVars,
  decryptEnvVars,
  maskSecret,
} from './encryption.service.js';


describe('encryption.service', () => {
  describe('encrypt and decrypt', () => {
    it('round-trip preserves plaintext', () => {
      const plaintext = 'DATABASE_URL=postgresql://localhost:5432/mydb';
      const encrypted = encrypt(plaintext);
      const decrypted = decrypt(encrypted);
      expect(decrypted).toBe(plaintext);
    });

    it('encrypts same plaintext to different ciphertexts due to random IV', () => {
      const text = 'my-secret-key-12345';
      const enc1 = encrypt(text);
      const enc2 = encrypt(text);
      expect(enc1).not.toBe(enc2);
      expect(decrypt(enc1)).toBe(text);
      expect(decrypt(enc2)).toBe(text);
    });

    it('outputs format iv:authTag:ciphertext with 3 hex parts', () => {
      const encrypted = encrypt('hello world');
      const parts = encrypted.split(':');
      expect(parts.length).toBe(3);
      // IV is 16 bytes = 32 hex chars
      expect(parts[0]).toMatch(/^[0-9a-f]{32}$/i);
      // AuthTag is 16 bytes = 32 hex chars
      expect(parts[1]).toMatch(/^[0-9a-f]{32}$/i);
      // Ciphertext hex
      expect(parts[2]).toMatch(/^[0-9a-f]+$/i);
    });

    it('throws error when decrypting tampered ciphertext', () => {
      const encrypted = encrypt('confidential data');
      const parts = encrypted.split(':');
      // Tamper ciphertext
      const tamperedHex = parts[2].slice(0, -2) + (parts[2].endsWith('a') ? 'b' : 'a');
      const tamperedPayload = `${parts[0]}:${parts[1]}:${tamperedHex}`;
      expect(() => decrypt(tamperedPayload)).toThrow();
    });

    it('throws error on invalid format with missing segments', () => {
      expect(() => decrypt('not-a-valid-encrypted-string')).toThrow(
        /Invalid encrypted payload format/
      );
      expect(() => decrypt('part1:part2')).toThrow(
        /Invalid encrypted payload format/
      );
    });

    it('handles empty plaintext string', () => {
      const encrypted = encrypt('');
      expect(decrypt(encrypted)).toBe('');
    });

    it('handles special characters, multiline, and unicode', () => {
      const specialText = '🔑 Secret = "hello world"\nLine 2: 🚀 & <XML> symbols!';
      const encrypted = encrypt(specialText);
      expect(decrypt(encrypted)).toBe(specialText);
    });
  });

  describe('encryptEnvVars and decryptEnvVars', () => {
    it('encrypts all values in a record', () => {
      const envs = {
        API_KEY: 'sk_live_123456789',
        DB_PASS: 'p@$$w0rd',
      };
      const encrypted = encryptEnvVars(envs);
      expect(encrypted.API_KEY.split(':').length).toBe(3);
      expect(encrypted.DB_PASS.split(':').length).toBe(3);
    });

    it('decrypts encrypted env vars back to original record', () => {
      const original = {
        API_KEY: 'sk_live_123456789',
        DB_PASS: 'p@$$w0rd',
        DEBUG: 'true',
      };
      const encrypted = encryptEnvVars(original);
      const decrypted = decryptEnvVars(encrypted);
      expect(decrypted).toEqual(original);
    });

    it('marks corrupt values as [DECRYPTION_FAILED] without throwing', () => {
      const original = {
        VALID_KEY: 'valid_val',
        CORRUPT_KEY: 'bad_val',
      };
      const encrypted = encryptEnvVars(original);
      encrypted.CORRUPT_KEY = 'corrupted:payload:format';

      const decrypted = decryptEnvVars(encrypted);
      expect(decrypted.VALID_KEY).toBe('valid_val');
      expect(decrypted.CORRUPT_KEY).toBe('[DECRYPTION_FAILED]');
    });
  });

  describe('maskSecret', () => {
    it('returns empty string for falsy/empty values', () => {
      expect(maskSecret('')).toBe('');
    });

    it('masks values with 4 or fewer characters completely', () => {
      expect(maskSecret('1234')).toBe('••••');
      expect(maskSecret('ab')).toBe('••••');
    });

    it('masks long secrets retaining only the last 4 characters', () => {
      expect(maskSecret('super-secret-key-123')).toBe('••••••••-123');
      expect(maskSecret('postgresql://user:pass@localhost:5432')).toBe('••••••••5432');
    });

    it('preserves [DECRYPTION_FAILED] marker without masking', () => {
      expect(maskSecret('[DECRYPTION_FAILED]')).toBe('[DECRYPTION_FAILED]');
    });
  });
});

