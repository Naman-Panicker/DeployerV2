import type { ConnectionOptions } from 'bullmq';
import { env } from '@deployer/config';

// Queue names shared by the API Gateway (producer) and Build Server (worker)
export const BUILD_QUEUE = 'deployer-builds';
export const COPY_QUEUE = 'deployer-artifact-copy';

export interface BuildJobData {
  projectId: string;
  deploymentId: string;
  repoUrl: string;
  branch: string;
  // Values stay AES-256-GCM encrypted while in Redis; the Build Server decrypts them
  envVarsEncrypted: Record<string, string>;
}

export interface CopyJobData {
  sourcePrefix: string;
  destinationPrefix: string;
}

export interface CopyJobResult {
  success: boolean;
  copiedCount: number;
  errorMessage?: string;
}

/**
 * Builds BullMQ connection options from REDIS_URL.
 * Workers and QueueEvents issue blocking commands and require maxRetriesPerRequest: null.
 * Producers keep the ioredis default so enqueue calls fail instead of hanging when Redis is down.
 */
export function getRedisConnection(opts: { blocking?: boolean } = {}): ConnectionOptions {
  const url = new URL(env.REDIS_URL);

  return {
    host: url.hostname,
    port: url.port ? parseInt(url.port, 10) : 6379,
    username: url.username ? decodeURIComponent(url.username) : undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    db: url.pathname.length > 1 ? parseInt(url.pathname.slice(1), 10) : 0,
    tls: url.protocol === 'rediss:' ? {} : undefined,
    ...(opts.blocking ? { maxRetriesPerRequest: null } : {}),
  };
}
