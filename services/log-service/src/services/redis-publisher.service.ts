import { Redis } from 'ioredis';
import { env } from '@deployer/config';

let publisher: Redis | null = null;

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
      console.log('[Redis Publisher] Connected to Redis at', env.REDIS_URL);
    });

    publisher.on('error', (err: Error) => {
      console.error('[Redis Publisher] Error:', err.message);
    });
  }

  return publisher;
}

export async function publishToChannel(channel: string, message: string): Promise<number> {
  const pub = getRedisPublisher();
  return pub.publish(channel, message);
}

export async function stopPublisher(): Promise<void> {
  if (publisher) {
    try {
      await publisher.quit();
      console.log('[Redis Publisher] Disconnected cleanly');
    } catch (err) {
      console.error('[Redis Publisher] Error during shutdown:', err);
    } finally {
      publisher = null;
    }
  }
}
