import { ensureBuildImage } from './services/docker.service.js';
import { initializeBucket } from './services/s3.service.js';
import { startWorkers, stopWorkers } from './services/queue.service.js';

async function main() {
  // Pre-pull / verify build container image on startup
  await ensureBuildImage().catch((err) => {
    console.warn('[Build Server] Warning: Could not verify Docker build image on startup:', err.message);
  });

  // Verify/create S3 bucket on startup
  await initializeBucket().catch((err) => {
    console.warn('[Build Server] Warning: Could not initialize S3 bucket on startup:', err.message);
  });

  startWorkers();

  console.log(`========================================================`);
  console.log(`[Build Server] Running. Consuming build and artifact copy jobs from Redis.`);
  console.log(`========================================================`);

  let isShuttingDown = false;
  const shutdown = async () => {
    if (isShuttingDown) return;
    isShuttingDown = true;

    console.log('\n[Build Server] Shutting down gracefully (waiting for active jobs)...');
    try {
      await stopWorkers();
      console.log('[Build Server] Workers stopped cleanly.');
    } catch (err) {
      console.error('[Build Server] Error while stopping workers:', err);
    }
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('[Build Server] Fatal error during startup:', err);
  process.exit(1);
});
