import { env } from '@deployer/config';

console.log(`[Log Service] Starting log polling/streaming service on port ${env.LOG_SERVICE_PORT}...`);
console.log(`[Log Service] Redis URL configured: ${Boolean(env.REDIS_URL)}`);
console.log(`[Log Service] Service skeleton initialized successfully.`);
