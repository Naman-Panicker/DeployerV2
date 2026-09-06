import { env } from '@deployer/config';
import { createServer } from './server.js';
import { isS3Configured } from './services/s3-fetcher.service.js';

async function main() {
  const port = env.REVERSE_PROXY_PORT || 8080;

  // 1. Check S3 credentials status
  const s3Ready = isS3Configured();
  if (!s3Ready) {
    console.warn(
      '[Reverse Proxy] Notice: AWS S3 credentials are placeholders or not configured. Static asset serving from S3 will return 503 until valid AWS credentials are provided.'
    );
  }

  // 2. Start HTTP server
  const server = createServer();
  server.listen(port, () => {
    console.log('========================================================');
    console.log(`[Reverse Proxy] Serving layer running on port ${port}`);
    console.log(`[Reverse Proxy] Subdomain routing: http://<subdomain>.localhost:${port}`);
    console.log(`[Reverse Proxy] S3 bucket target: ${env.S3_BUCKET_NAME}`);
    console.log(`[Reverse Proxy] S3 configured: ${s3Ready}`);
    console.log('========================================================');
  });

  // 3. Graceful shutdown handling
  let isShuttingDown = false;
  const shutdown = () => {
    if (isShuttingDown) return;
    isShuttingDown = true;

    console.log('\n[Reverse Proxy] Shutting down serving layer gracefully...');
    server.close(() => {
      console.log('[Reverse Proxy] HTTP server stopped.');
      process.exit(0);
    });

    // Force exit after 5 seconds if connections don't drain
    setTimeout(() => {
      console.warn('[Reverse Proxy] Forced shutdown after timeout.');
      process.exit(0);
    }, 5000).unref();
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('[Reverse Proxy] Fatal error during startup:', err);
  process.exit(1);
});
