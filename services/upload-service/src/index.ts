import { env } from '@deployer/config';
import { startServer } from './server.js';

async function main() {
  const port = env.UPLOAD_SERVICE_PORT || 9002;
  const server = await startServer(port);

  const shutdown = () => {
    console.log('[Upload Service] Gracefully stopping gRPC server...');
    server.tryShutdown((err) => {
      if (err) {
        console.error('[Upload Service] Error during graceful shutdown, forcing stop:', err);
        server.forceShutdown();
      } else {
        console.log('[Upload Service] gRPC server stopped.');
      }
      process.exit(0);
    });
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('[Upload Service] Fatal error during startup:', err);
  process.exit(1);
});
