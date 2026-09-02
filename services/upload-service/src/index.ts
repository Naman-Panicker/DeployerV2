import { env } from '@deployer/config';

console.log(`[Upload Service] Starting gRPC service on port ${env.UPLOAD_SERVICE_PORT}...`);
console.log(`[Upload Service] S3 Bucket configured: ${env.S3_BUCKET_NAME}`);
console.log(`[Upload Service] Service skeleton initialized successfully.`);
