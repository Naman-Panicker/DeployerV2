import { env } from '@deployer/config';

console.log(`[Reverse Proxy] Starting serving layer on port ${env.REVERSE_PROXY_PORT}...`);
console.log(`[Reverse Proxy] S3 Bucket configured: ${env.S3_BUCKET_NAME}`);
console.log(`[Reverse Proxy] Service skeleton initialized successfully.`);
