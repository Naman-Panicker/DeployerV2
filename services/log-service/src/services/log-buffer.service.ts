import { prisma } from '@deployer/prisma';

export interface BufferedLog {
  deploymentId: string;
  stream: string;
  line: string;
  timestamp: Date;
}

const FLUSH_THRESHOLD_LINES = 50;
const DEFAULT_FLUSH_INTERVAL_MS = 2000;

const buffers = new Map<string, BufferedLog[]>();
const completedDeployments = new Set<string>();
let flushIntervalTimer: NodeJS.Timeout | null = null;
let isFlushingAll = false;

/**
 * Pushes an incoming log message to the in-memory buffer.
 * Triggers an immediate flush if the buffer exceeds the line threshold.
 */
export async function handleLogMessage(
  deploymentId: string,
  stream: string,
  line: string,
  timestampStr?: string
): Promise<void> {
  const timestamp = timestampStr ? new Date(timestampStr) : new Date();

  let deploymentBuffer = buffers.get(deploymentId);
  if (!deploymentBuffer) {
    deploymentBuffer = [];
    buffers.set(deploymentId, deploymentBuffer);
  }

  deploymentBuffer.push({
    deploymentId,
    stream,
    line,
    timestamp,
  });

  if (deploymentBuffer.length >= FLUSH_THRESHOLD_LINES) {
    await flushBuffer(deploymentId).catch((err) => {
      console.error(`[LogBuffer] Failed threshold flush for deployment ${deploymentId}:`, err);
    });
  }
}

/**
 * Flushes buffered logs for a specific deployment to PostgreSQL.
 */
export async function flushBuffer(deploymentId: string): Promise<void> {
  const deploymentBuffer = buffers.get(deploymentId);
  if (!deploymentBuffer || deploymentBuffer.length === 0) {
    if (completedDeployments.has(deploymentId)) {
      buffers.delete(deploymentId);
    }
    return;
  }

  // Copy and drain buffer to prevent race conditions during insertion
  const logsToFlush = deploymentBuffer.splice(0, deploymentBuffer.length);

  try {
    await prisma.deploymentLog.createMany({
      data: logsToFlush.map((item) => ({
        deploymentId: item.deploymentId,
        stream: item.stream,
        line: item.line,
        timestamp: item.timestamp,
      })),
    });

    // Cleanup if completed and drained
    if (completedDeployments.has(deploymentId) && (!buffers.get(deploymentId) || buffers.get(deploymentId)!.length === 0)) {
      buffers.delete(deploymentId);
    }
  } catch (err) {
    // If DB insert failed, restore drained logs to front of buffer for retry
    console.error(`[LogBuffer] Failed to persist ${logsToFlush.length} logs for ${deploymentId}:`, err);
    const existing = buffers.get(deploymentId) || [];
    buffers.set(deploymentId, [...logsToFlush, ...existing]);
    throw err;
  }
}

/**
 * Marks a deployment as completed.
 */
export function markComplete(deploymentId: string): void {
  completedDeployments.add(deploymentId);
}

/**
 * Checks if a deployment has been marked as complete in memory.
 */
export function isMarkedComplete(deploymentId: string): boolean {
  return completedDeployments.has(deploymentId);
}

/**
 * Flushes all non-empty buffers across all deployments.
 */
export async function flushAll(): Promise<void> {
  if (isFlushingAll) return;
  isFlushingAll = true;

  try {
    const deploymentIds = Array.from(buffers.keys());
    await Promise.all(
      deploymentIds.map(async (deploymentId) => {
        try {
          await flushBuffer(deploymentId);
        } catch (err) {
          console.error(`[LogBuffer] Error flushing buffer during flushAll for ${deploymentId}:`, err);
        }
      })
    );
  } finally {
    isFlushingAll = false;
  }
}

/**
 * Starts periodic flushing timer.
 */
export function startFlushInterval(intervalMs: number = DEFAULT_FLUSH_INTERVAL_MS): void {
  if (flushIntervalTimer) return;

  flushIntervalTimer = setInterval(() => {
    flushAll().catch((err) => {
      console.error('[LogBuffer] Periodic flush failed:', err);
    });
  }, intervalMs);
}

/**
 * Stops periodic flushing timer.
 */
export function stopFlushInterval(): void {
  if (flushIntervalTimer) {
    clearInterval(flushIntervalTimer);
    flushIntervalTimer = null;
  }
}

/**
 * Helper for tests to inspect in-memory buffer count.
 */
export function getBufferSize(deploymentId: string): number {
  return buffers.get(deploymentId)?.length || 0;
}

/**
 * Helper for tests to clear all in-memory buffer state.
 */
export function clearBufferState(): void {
  buffers.clear();
  completedDeployments.clear();
}
