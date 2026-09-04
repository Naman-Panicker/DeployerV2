import mime from 'mime-types';
import path from 'node:path';

export function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  
  // Custom overrides / common fallbacks for web deployment
  if (ext === '.ts' || ext === '.tsx') {
    return 'application/javascript; charset=utf-8';
  }
  if (ext === '.wasm') {
    return 'application/wasm';
  }
  if (ext === '.map') {
    return 'application/json';
  }

  const lookup = mime.lookup(filePath);
  if (typeof lookup === 'string') {
    return lookup;
  }

  return 'application/octet-stream';
}
