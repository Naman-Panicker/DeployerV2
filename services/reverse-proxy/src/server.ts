import http, { IncomingMessage, ServerResponse } from 'node:http';
import { handleRequest } from './handlers/static-file.handler.js';

export function createServer(): http.Server {
  return http.createServer(async (req: IncomingMessage, res: ServerResponse) => {
    // Health check endpoint (can be accessed with or without subdomain)
    if (req.url === '/health') {
      const payload = JSON.stringify({
        status: 'ok',
        service: 'reverse-proxy',
        timestamp: new Date().toISOString(),
      });
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      });
      res.end(payload);
      return;
    }

    try {
      await handleRequest(req, res);
    } catch (err) {
      console.error('[Reverse Proxy] Uncaught handler error:', err);
      if (!res.headersSent) {
        const errorBody = '<!DOCTYPE html><html><body><h1>500 Internal Server Error</h1></body></html>';
        res.writeHead(500, {
          'Content-Type': 'text/html; charset=utf-8',
          'Content-Length': Buffer.byteLength(errorBody),
        });
        res.end(errorBody);
      } else {
        res.end();
      }
    }
  });
}
