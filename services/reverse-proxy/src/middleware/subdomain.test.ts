import { describe, it, expect } from 'vitest';
import { extractSubdomain } from './subdomain.js';

describe('subdomain middleware - extractSubdomain', () => {
  it('extracts subdomain with port number', () => {
    expect(extractSubdomain('my-app.localhost:8080')).toBe('my-app');
  });

  it('extracts subdomain without port number', () => {
    expect(extractSubdomain('my-app.localhost')).toBe('my-app');
  });

  it('returns null for bare localhost with port', () => {
    expect(extractSubdomain('localhost:8080')).toBeNull();
  });

  it('returns null for bare localhost without port', () => {
    expect(extractSubdomain('localhost')).toBeNull();
  });

  it('returns null for IPv4 loopback', () => {
    expect(extractSubdomain('127.0.0.1:8080')).toBeNull();
    expect(extractSubdomain('127.0.0.1')).toBeNull();
  });

  it('returns null for IPv6 loopback', () => {
    expect(extractSubdomain('::1')).toBeNull();
  });

  it('returns null for arbitrary IPv4 addresses', () => {
    expect(extractSubdomain('192.168.1.100:3000')).toBeNull();
    expect(extractSubdomain('10.0.0.1')).toBeNull();
  });

  it('extracts subdomain on custom domains', () => {
    expect(extractSubdomain('dashboard.deployer.dev:443')).toBe('dashboard');
    expect(extractSubdomain('preview-123.platform.example.com')).toBe('preview-123');
  });

  it('returns null for undefined, null, or empty string', () => {
    expect(extractSubdomain(undefined)).toBeNull();
    expect(extractSubdomain('')).toBeNull();
  });

  it('is case-insensitive', () => {
    expect(extractSubdomain('My-Cool-Project.LOCALHOST:8080')).toBe('my-cool-project');
  });
});
