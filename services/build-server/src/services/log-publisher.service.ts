import { Redis } from 'ioredis';
import { env } from '@deployer/config';

export type LogStream = 'stdout' | 'stderr' | 'system';

let publisher: Redis | null = null;

function getPublisher(): Redis {
  if (!publisher) {
    publisher = new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: 3,
      retryStrategy(times: number) {
        return Math.min(times * 200, 2000);
      },
    });

    publisher.on('connect', () => {
      console.log('[Log Publisher] Connected to Redis');
    });

    publisher.on('error', (err: Error) => {
      console.error('[Log Publisher] Error:', err.message);
    });
  }

  return publisher;
}

/**
 * Opens the Redis connection up front so the first build's log lines aren't delayed.
 */
export function startLogPublisher(): void {
  getPublisher();
}

/**
 * Publishes a build log line to `logs:<deploymentId>`, the channel the Log Service
 * subscribes to. Build containers have no route to Redis, so all build logs go through here.
 * Resolves false instead of throwing when Redis is unavailable.
 */
export async function publishLog(deploymentId: string, stream: LogStream, line: string): Promise<boolean> {
  try {
    await getPublisher().publish(
      `logs:${deploymentId}`,
      JSON.stringify({ stream, line, timestamp: new Date().toISOString() })
    );
    return true;
  } catch {
    // Ignore logging failures to avoid masking underlying build errors
    return false;
  }
}

export async function stopLogPublisher(): Promise<void> {
  if (publisher) {
    try {
      await publisher.quit();
    } catch (err) {
      console.error('[Log Publisher] Error during shutdown:', err);
    } finally {
      publisher = null;
    }
  }
}
