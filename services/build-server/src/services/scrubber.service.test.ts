import { describe, it, expect } from 'vitest';
import { createScrubber } from './scrubber.service.js';

describe('scrubber.service', () => {
  it('redacts configured secret values with [REDACTED]', () => {
    const scrubber = createScrubber({
      DATABASE_PASSWORD: 'supersecretpassword123',
    });

    const logLine = 'Connecting to db with password supersecretpassword123 ... ok';
    expect(scrubber.scrub(logLine)).toBe(
      'Connecting to db with password [REDACTED] ... ok'
    );
  });

  it('redacts multiple distinct secrets in a single log line', () => {
    const scrubber = createScrubber({
      API_KEY: 'abc123secretxyz',
      AUTH_TOKEN: 'token-99887766',
    });

    const logLine = 'Sending key=abc123secretxyz and auth=token-99887766';
    expect(scrubber.scrub(logLine)).toBe(
      'Sending key=[REDACTED] and auth=[REDACTED]'
    );
  });

  it('ignores secrets that are shorter than default minLength (4 characters)', () => {
    const scrubber = createScrubber({
      PORT: '80',
      ENV: 'dev',
      VALID_SECRET: 'longenoughsecret',
    });

    const logLine = 'Server running on port 80 in dev mode with longenoughsecret';
    expect(scrubber.scrub(logLine)).toBe(
      'Server running on port 80 in dev mode with [REDACTED]'
    );
  });

  it('respects a custom minLength parameter', () => {
    const scrubber = createScrubber(
      {
        SHORT: '12345',
        LONG: '1234567890',
      },
      8 // only secrets >= 8 characters
    );

    const logLine = 'Values: 12345 and 1234567890';
    expect(scrubber.scrub(logLine)).toBe('Values: 12345 and [REDACTED]');
  });

  it('redacts longest secrets first to avoid partial overlap corruption', () => {
    const scrubber = createScrubber({
      SUB: 'password',
      FULL: 'password12345',
    });

    const logLine = 'The secret is password12345!';
    // If 'password' were redacted first, it would become '[REDACTED]12345'.
    // Redacting longest first yields '[REDACTED]!'.
    expect(scrubber.scrub(logLine)).toBe('The secret is [REDACTED]!');
  });

  it('returns log line untouched when envVars is empty', () => {
    const scrubber = createScrubber({});
    const logLine = 'Build step 1: compiling typescript';
    expect(scrubber.scrub(logLine)).toBe(logLine);
  });

  it('handles empty line or whitespace line gracefully', () => {
    const scrubber = createScrubber({ SECRET: 'mysecret' });
    expect(scrubber.scrub('')).toBe('');
  });

  it('deduplicates identical secret values across different env keys', () => {
    const scrubber = createScrubber({
      KEY1: 'identical-secret-value',
      KEY2: 'identical-secret-value',
    });

    const logLine = 'Value: identical-secret-value';
    expect(scrubber.scrub(logLine)).toBe('Value: [REDACTED]');
  });
});
