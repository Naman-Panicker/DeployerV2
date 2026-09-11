import { env } from '@deployer/config';
import { createApp } from './app.js';
import { startSubscriber, stopSubscriber } from './services/redis-subscriber.service.js';
import { stopPublisher } from './services/redis-publisher.service.js';
import { startFlushInterval, stopFlushInterval, flushAll } from './services/log-buffer.service.js';

async function main() {
  const port = env.LOG_SERVICE_PORT || 9003;

  // 1. Start Redis subscriber for build logs
  await startSubscriber();

  // 2. Start the periodic flush interval
  startFlushInterval();

  // 3. Start Express HTTP server
  const app = createApp();
  const server = app.listen(port, () => {
    console.log('========================================================');
    console.log(`[Log Service] HTTP server running on port ${port}`);
    console.log(`[Log Service] Redis subscriber active (pattern: logs:*)`);
    console.log(`[Log Service] Polling endpoint: GET /api/logs/:deploymentId`);
    console.log('========================================================');
  });

  // Graceful shutdown handling
  let isShuttingDown = false;
  const shutdown = async () => {
    if (isShuttingDown) return;
    isShuttingDown = true;

    console.log('\n[Log Service] Shutting down gracefully...');
    stopFlushInterval();

    try {
      await flushAll();
      console.log('[Log Service] All buffered logs persisted to DB.');
    } catch (err) {
      console.error('[Log Service] Error while draining log buffers:', err);
    }

    await stopSubscriber();
    await stopPublisher();

    server.close(() => {
      console.log('[Log Service] HTTP server stopped cleanly.');
      process.exit(0);
    });
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('[Log Service] Fatal error during startup:', err);
  process.exit(1);
});
