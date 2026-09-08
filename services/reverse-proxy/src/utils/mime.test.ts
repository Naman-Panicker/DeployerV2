import { describe, it, expect } from 'vitest';
import { getMimeType, hasFileExtension } from './mime.js';

describe('mime utilities', () => {
  describe('getMimeType', () => {
    it('detects HTML files', () => {
      expect(getMimeType('index.html')).toBe('text/html; charset=utf-8');
      expect(getMimeType('/subfolder/about.htm')).toBe('text/html; charset=utf-8');
    });

    it('detects CSS files', () => {
      expect(getMimeType('style.css')).toBe('text/css; charset=utf-8');
    });

    it('detects JavaScript and MJS files', () => {
      expect(getMimeType('main.js')).toBe('application/javascript; charset=utf-8');
      expect(getMimeType('bundle.mjs')).toBe('application/javascript; charset=utf-8');
    });

    it('detects TypeScript and TSX files', () => {
      expect(getMimeType('app.ts')).toBe('application/javascript; charset=utf-8');
      expect(getMimeType('button.tsx')).toBe('application/javascript; charset=utf-8');
    });

    it('detects WebAssembly files', () => {
      expect(getMimeType('module.wasm')).toBe('application/wasm');
    });

    it('detects source map files', () => {
      expect(getMimeType('main.js.map')).toBe('application/json');
    });

    it('detects JSON files', () => {
      expect(getMimeType('manifest.json')).toBe('application/json; charset=utf-8');
    });

    it('detects image files via mime lookup', () => {
      expect(getMimeType('logo.png')).toBe('image/png');
      expect(getMimeType('photo.jpg')).toBe('image/jpeg');
      expect(getMimeType('icon.svg')).toBe('image/svg+xml');
    });

    it('falls back to application/octet-stream for unknown extensions', () => {
      expect(getMimeType('file.xyzunknown123')).toBe('application/octet-stream');
      expect(getMimeType('noextension')).toBe('application/octet-stream');
    });
  });

  describe('hasFileExtension', () => {
    it('returns true for files with extensions', () => {
      expect(hasFileExtension('/assets/index-abc123.js')).toBe(true);
      expect(hasFileExtension('/favicon.ico')).toBe(true);
      expect(hasFileExtension('styles.css')).toBe(true);
    });

    it('returns false for paths without extensions', () => {
      expect(hasFileExtension('/')).toBe(false);
      expect(hasFileExtension('/dashboard')).toBe(false);
      expect(hasFileExtension('/users/1234/profile')).toBe(false);
    });

    it('strips query parameters and hashes before checking extension', () => {
      expect(hasFileExtension('/bundle.js?v=2')).toBe(true);
      expect(hasFileExtension('/dashboard?tab=billing')).toBe(false);
      expect(hasFileExtension('/app.css#section1')).toBe(true);
    });
  });
});
