import { Redis } from 'ioredis';
import { env } from '@deployer/config';
import {
  handleLogMessage,
  markComplete,
  flushBuffer,
} from './log-buffer.service.js';

let subscriber: Redis | null = null;

export interface LogMessagePayload {
  stream: string;
  line: string;
  timestamp?: string;
}

/**
 * Starts the dedicated Redis subscriber and pattern subscribes to `logs:*`.
 */
export async function startSubscriber(): Promise<Redis> {
  if (subscriber) {
    return subscriber;
  }

  subscriber = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    retryStrategy(times: number) {
      return Math.min(times * 200, 2000);
    },
  });

  subscriber.on('connect', () => {
    console.log('[Redis Subscriber] Connected to Redis at', env.REDIS_URL);
  });

  subscriber.on('error', (err) => {
    console.error('[Redis Subscriber] Error:', err.message);
  });

  subscriber.on('pmessage', async (_pattern: string, channel: string, message: string) => {
    if (!channel.startsWith('logs:')) return;
    const deploymentId = channel.slice(5);

    try {
      const payload: LogMessagePayload = JSON.parse(message);

      if (payload.stream === 'system' && payload.line === 'BUILD_COMPLETE') {
        markComplete(deploymentId);
        await flushBuffer(deploymentId).catch((err) => {
          console.error(`[Redis Subscriber] Failed to flush buffer on BUILD_COMPLETE for ${deploymentId}:`, err);
        });
        return;
      }

      await handleLogMessage(
        deploymentId,
        payload.stream || 'stdout',
        payload.line || '',
        payload.timestamp
      );
    } catch (err) {
      console.error(`[Redis Subscriber] Error processing message on ${channel}:`, err);
    }
  });

  await subscriber.psubscribe('logs:*');
  console.log('[Redis Subscriber] Subscribed to pattern logs:*');

  return subscriber;
}

/**
 * Unsubscribes and gracefully quits the Redis subscriber connection.
 */
export async function stopSubscriber(): Promise<void> {
  if (subscriber) {
    try {
      await subscriber.punsubscribe('logs:*');
      await subscriber.quit();
      console.log('[Redis Subscriber] Subscriber unsubscribed and disconnected');
    } catch (err) {
      console.error('[Redis Subscriber] Error during subscriber shutdown:', err);
    } finally {
      subscriber = null;
    }
  }
}
