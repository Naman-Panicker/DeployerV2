import { env } from '@deployer/config';
import { startServer } from './server.js';

async function main() {
  const port = env.BUILD_SERVER_PORT || 9001;

  const server = await startServer(port);

  const shutdown = () => {
    console.log('\n[Build Server] Shutting down gracefully...');
    server.tryShutdown((err) => {
      if (err) {
        console.error('[Build Server] Graceful shutdown error, forcing close:', err);
        server.forceShutdown();
      }
      console.log('[Build Server] Server stopped cleanly.');
      process.exit(0);
    });
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('[Build Server] Fatal error during startup:', err);
  process.exit(1);
});
