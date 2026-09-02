import { env } from '@deployer/config';

console.log(`[Build Server] Starting gRPC service on port ${env.BUILD_SERVER_PORT}...`);
console.log(`[Build Server] Redis URL configured: ${Boolean(env.REDIS_URL)}`);
console.log(`[Build Server] Service skeleton initialized successfully.`);
