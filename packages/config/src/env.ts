import dotenv from 'dotenv';
import path from 'node:path';
import fs from 'node:fs';

// Walk up until root .env is found
function findEnvPath(): string {
  let currentDir = process.cwd();
  for (let i = 0; i < 5; i++) {
    const candidate = path.join(currentDir, '.env');
    if (fs.existsSync(candidate)) {
      return candidate;
    }
    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) break;
    currentDir = parentDir;
  }
  return path.resolve(process.cwd(), '.env');
}

dotenv.config({ path: findEnvPath() });

export const env = {
  // PostgreSQL Database
  DATABASE_URL: process.env.DATABASE_URL || 'postgresql://postgres:password@localhost:5432/deployer_db',

  // Redis
  REDIS_URL: process.env.REDIS_URL || 'redis://localhost:6379',

  // AWS S3
  AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID || '',
  AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY || '',
  AWS_REGION: process.env.AWS_REGION || 'ap-south-1',
  S3_BUCKET_NAME: process.env.S3_BUCKET_NAME || 'deployer-artifacts',

  // JWT
  JWT_SECRET: process.env.JWT_SECRET || 'deployer-dev-secret-change-in-prod-32-chars-long',

  // Encryption (AES-256 for environment variables)
  ENCRYPTION_KEY: process.env.ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',

  // Service Ports & Hosts
  API_GATEWAY_PORT: parseInt(process.env.API_GATEWAY_PORT || '9000', 10),
  LOG_SERVICE_PORT: parseInt(process.env.LOG_SERVICE_PORT || '9003', 10),
  LOG_SERVICE_URL: process.env.LOG_SERVICE_URL || 'http://localhost:9003',
  REVERSE_PROXY_PORT: parseInt(process.env.REVERSE_PROXY_PORT || '8080', 10),

  // GitHub Webhook
  GITHUB_WEBHOOK_SECRET: process.env.GITHUB_WEBHOOK_SECRET || '',
} as const;

export type EnvConfig = typeof env;
