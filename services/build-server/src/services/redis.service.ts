import { Redis } from 'ioredis';
import { env } from '@deployer/config';

let publisher: Redis | null = null;

/**
 * Returns the singleton Redis publisher instance.
 * Reconnects automatically if disconnected.
 */
export function getRedisPublisher(): Redis {
  if (!publisher) {
    publisher = new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: 3,
      retryStrategy(times: number) {
        if (times > 10) return null;
        return Math.min(times * 200, 2000);
      },
    });

    publisher.on('connect', () => {
      console.log('[Redis] Log publisher connected');
    });

    publisher.on('error', (err: Error) => {
      console.error('[Redis] Publisher error:', err.message);
    });
  }

  return publisher;
}

/**
 * Publishes a single log line to the Redis channel `logs:<deploymentId>`.
 * Subscribers (e.g. SSE / WebSocket endpoints) receive structured JSON.
 */
export async function publishLog(
  deploymentId: string,
  stream: 'stdout' | 'stderr',
  line: string
): Promise<void> {
  const channel = `logs:${deploymentId}`;
  const payload = JSON.stringify({
    stream,
    line,
    timestamp: new Date().toISOString(),
  });

  try {
    await getRedisPublisher().publish(channel, payload);
  } catch (err) {
    console.error(`[Redis] Failed to publish log to ${channel}:`, err);
  }
}

/**
 * Publishes a BUILD_COMPLETE system signal on the deployment's log channel.
 * Allows log stream consumers to gracefully close their subscriptions.
 */
export async function publishBuildComplete(deploymentId: string): Promise<void> {
  const channel = `logs:${deploymentId}`;
  const payload = JSON.stringify({
    stream: 'system',
    line: 'BUILD_COMPLETE',
    timestamp: new Date().toISOString(),
  });

  try {
    await getRedisPublisher().publish(channel, payload);
    console.log(`[Redis] Published BUILD_COMPLETE for ${deploymentId}`);
  } catch (err) {
    console.error(`[Redis] Failed to publish BUILD_COMPLETE for ${deploymentId}:`, err);
  }
}

/**
 * Gracefully disconnects the Redis publisher.
 */
export async function disconnectRedis(): Promise<void> {
  if (publisher) {
    await publisher.quit();
    publisher = null;
    console.log('[Redis] Log publisher disconnected');
  }
}
