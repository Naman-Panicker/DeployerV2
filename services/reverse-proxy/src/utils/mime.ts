import mime from 'mime-types';
import path from 'node:path';

/**
 * Returns the MIME content type based on the file extension.
 */
export function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();

  // Custom overrides / common web standards
  if (ext === '.ts' || ext === '.tsx') {
    return 'application/javascript; charset=utf-8';
  }
  if (ext === '.wasm') {
    return 'application/wasm';
  }
  if (ext === '.map') {
    return 'application/json';
  }
  if (ext === '.html' || ext === '.htm') {
    return 'text/html; charset=utf-8';
  }
  if (ext === '.js' || ext === '.mjs') {
    return 'application/javascript; charset=utf-8';
  }
  if (ext === '.css') {
    return 'text/css; charset=utf-8';
  }
  if (ext === '.json') {
    return 'application/json; charset=utf-8';
  }

  const lookup = mime.lookup(filePath);
  if (typeof lookup === 'string') {
    return lookup;
  }

  return 'application/octet-stream';
}

/**
 * Checks if a URL path contains a file extension in its trailing segment.
 * Useful for determining whether to perform SPA fallback to index.html.
 */
export function hasFileExtension(urlPath: string): boolean {
  const cleanPath = urlPath.split('?')[0].split('#')[0];
  const lastSegment = path.basename(cleanPath);
  return path.extname(lastSegment).length > 0;
}
