import { env } from '@deployer/config';
import { createApp } from './app.js';

const app = createApp();

const server = app.listen(env.API_GATEWAY_PORT, () => {
  console.log(`========================================================`);
  console.log(`[API Gateway] Server running on http://localhost:${env.API_GATEWAY_PORT}`);
  console.log(`[API Gateway] Health check: http://localhost:${env.API_GATEWAY_PORT}/health`);
  console.log(`========================================================`);
});

// Graceful shutdown
const shutdown = () => {
  console.log('[API Gateway] Shutting down gracefully...');
  server.close(() => {
    console.log('[API Gateway] HTTP server closed.');
    process.exit(0);
  });
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
