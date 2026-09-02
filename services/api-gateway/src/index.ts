import { env } from '@deployer/config';

console.log(`[API Gateway] Starting on port ${env.API_GATEWAY_PORT}...`);
console.log(`[API Gateway] Database URL configured: ${Boolean(env.DATABASE_URL)}`);
console.log(`[API Gateway] Service skeleton initialized successfully.`);
