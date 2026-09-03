import crypto from 'node:crypto';
import { env } from '@deployer/config';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

/**
 * Derives a 32-byte Buffer key from the configured ENCRYPTION_KEY.
 * Handles hex strings, raw strings, etc.
 */
function getKey(): Buffer {
  const rawKey = env.ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef';
  if (/^[0-9a-fA-F]{64}$/.test(rawKey)) {
    return Buffer.from(rawKey, 'hex');
  }
  return crypto.createHash('sha256').update(rawKey).digest();
}

/**
 * Encrypts a plaintext string into a combined format: iv:authTag:ciphertext (base64)
 */
export function encrypt(plaintext: string): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  const authTag = cipher.getAuthTag();
  
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

/**
 * Decrypts a formatted ciphertext string (iv:authTag:ciphertext)
 */
export function decrypt(encryptedPayload: string): string {
  const parts = encryptedPayload.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted payload format');
  }

  const [ivHex, authTagHex, encryptedText] = parts;
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');

  const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

/**
 * Encrypts an environment variable dictionary { KEY: value }
 */
export function encryptEnvVars(envVars: Record<string, string>): Record<string, string> {
  const encrypted: Record<string, string> = {};
  for (const [key, val] of Object.entries(envVars)) {
    encrypted[key] = encrypt(val);
  }
  return encrypted;
}

/**
 * Decrypts an encrypted environment variable dictionary { KEY: encryptedValue }
 */
export function decryptEnvVars(encryptedEnvVars: Record<string, string>): Record<string, string> {
  const decrypted: Record<string, string> = {};
  for (const [key, val] of Object.entries(encryptedEnvVars)) {
    try {
      decrypted[key] = decrypt(val);
    } catch {
      decrypted[key] = '[DECRYPTION_FAILED]';
    }
  }
  return decrypted;
}
