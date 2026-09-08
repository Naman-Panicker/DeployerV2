import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import { generalLimiter, deployLimiter } from './rate-limiter.middleware.js';

describe('rate-limiter.middleware', () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    const app = express();
    app.use('/general', generalLimiter, (_req, res) => {
      res.status(200).json({ status: 'ok' });
    });
    app.use('/deploy', deployLimiter, (_req, res) => {
      res.status(200).json({ status: 'deploy triggered' });
    });

    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        const address = server.address();
        if (address && typeof address === 'object') {
          baseUrl = `http://127.0.0.1:${address.port}`;
        }
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  it('exports valid middleware functions', () => {
    expect(typeof generalLimiter).toBe('function');
    expect(typeof deployLimiter).toBe('function');
  });

  it('allows requests under the general limit', async () => {
    const res = await fetch(`${baseUrl}/general`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe('ok');
    expect(res.headers.get('ratelimit-limit')).toBeTruthy();
  });

  it('enforces deployLimiter max 5 requests per window (rejects 6th request)', async () => {
    // Make 5 successful requests
    for (let i = 0; i < 5; i++) {
      const res = await fetch(`${baseUrl}/deploy`);
      expect(res.status).toBe(200);
    }

    // 6th request should hit the rate limit (429)
    const rateLimitedRes = await fetch(`${baseUrl}/deploy`);
    expect(rateLimitedRes.status).toBe(429);
    const errorBody = await rateLimitedRes.json();
    expect(errorBody.error).toMatch(/Too many deployment requests/i);
  });
});
