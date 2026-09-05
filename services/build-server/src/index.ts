import { env } from '@deployer/config';
import { startServer } from './server.js';
import { getRedisPublisher, disconnectRedis } from './services/redis.service.js';

async function main() {
  const port = env.BUILD_SERVER_PORT || 9001;

  // Initialize Redis publisher connection
  getRedisPublisher();

  const server = await startServer(port);

  const shutdown = () => {
    console.log('\n[Build Server] Shutting down gracefully...');
    server.tryShutdown(async (err) => {
      if (err) {
        console.error('[Build Server] Graceful shutdown error, forcing close:', err);
        server.forceShutdown();
      }
      await disconnectRedis();
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
