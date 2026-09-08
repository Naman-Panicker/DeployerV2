import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import crypto from 'node:crypto';
import type { Request } from 'express';
import { env } from '@deployer/config';
import { verifyGitHubSignature } from './webhook.controller.js';

describe('webhook.controller - verifyGitHubSignature', () => {
  const originalSecret = env.GITHUB_WEBHOOK_SECRET;
  const testSecret = 'super-secret-webhook-key-12345';

  beforeEach(() => {
    (env as any).GITHUB_WEBHOOK_SECRET = testSecret;
  });

  afterEach(() => {
    (env as any).GITHUB_WEBHOOK_SECRET = originalSecret;
  });

  it('returns true when GITHUB_WEBHOOK_SECRET is empty (dev mode)', () => {
    (env as any).GITHUB_WEBHOOK_SECRET = '';
    const mockReq = {
      headers: {},
      body: { action: 'push' },
    } as unknown as Request;

    expect(verifyGitHubSignature(mockReq)).toBe(true);
  });

  it('returns false when signature header is missing', () => {
    const mockReq = {
      headers: {},
      body: { action: 'push' },
    } as unknown as Request;

    expect(verifyGitHubSignature(mockReq)).toBe(false);
  });

  it('returns true for a valid HMAC-SHA256 signature', () => {
    const payload = JSON.stringify({ ref: 'refs/heads/main', repository: { name: 'test-repo' } });
    const hmac = crypto.createHmac('sha256', testSecret).update(Buffer.from(payload)).digest('hex');
    const signature = `sha256=${hmac}`;

    const mockReq = {
      headers: {
        'x-hub-signature-256': signature,
      },
      rawBody: Buffer.from(payload),
      body: JSON.parse(payload),
    } as unknown as Request;

    expect(verifyGitHubSignature(mockReq)).toBe(true);
  });

  it('returns false for an invalid signature with same length', () => {
    const payload = JSON.stringify({ ref: 'refs/heads/main' });
    const wrongHmac = crypto.createHmac('sha256', 'wrong-secret').update(Buffer.from(payload)).digest('hex');
    const signature = `sha256=${wrongHmac}`;

    const mockReq = {
      headers: {
        'x-hub-signature-256': signature,
      },
      rawBody: Buffer.from(payload),
      body: JSON.parse(payload),
    } as unknown as Request;

    expect(verifyGitHubSignature(mockReq)).toBe(false);
  });

  it('returns false for a truncated or malformed signature', () => {
    const mockReq = {
      headers: {
        'x-hub-signature-256': 'sha256=tooshort',
      },
      rawBody: Buffer.from('{}'),
      body: {},
    } as unknown as Request;

    expect(verifyGitHubSignature(mockReq)).toBe(false);
  });
});
