import { Queue, QueueEvents } from 'bullmq';
import {
  BUILD_QUEUE,
  COPY_QUEUE,
  getRedisConnection,
  type BuildJobData,
  type CopyJobData,
  type CopyJobResult,
} from '@deployer/queue';

const COPY_TIMEOUT_MS = 60_000;
const ENQUEUE_ACK_TIMEOUT_MS = 5_000;

let buildQueue: Queue<BuildJobData> | null = null;
let copyQueue: Queue<CopyJobData, CopyJobResult> | null = null;
let copyQueueEvents: QueueEvents | null = null;
let copyOverride: ((data: CopyJobData) => Promise<CopyJobResult>) | null = null;

function getBuildQueue(): Queue<BuildJobData> {
  if (!buildQueue) {
    buildQueue = new Queue<BuildJobData>(BUILD_QUEUE, { connection: getRedisConnection() });
    buildQueue.on('error', (err) => console.error('[Build Queue] Redis error:', err.message));
    console.log(`[Build Queue] Producer ready for queue '${BUILD_QUEUE}'`);
  }
  return buildQueue;
}

function getCopyQueue(): Queue<CopyJobData, CopyJobResult> {
  if (!copyQueue) {
    copyQueue = new Queue<CopyJobData, CopyJobResult>(COPY_QUEUE, { connection: getRedisConnection() });
    copyQueue.on('error', (err) => console.error('[Copy Queue] Redis error:', err.message));
  }
  return copyQueue;
}

async function getCopyQueueEvents(): Promise<QueueEvents> {
  if (!copyQueueEvents) {
    copyQueueEvents = new QueueEvents(COPY_QUEUE, { connection: getRedisConnection({ blocking: true }) });
    copyQueueEvents.on('error', (err) => console.error('[Copy Queue] Events error:', err.message));
  }
  await copyQueueEvents.waitUntilReady();
  return copyQueueEvents;
}

/**
 * Replaces the copy job with a stub (used by the manual API test script).
 */
export function setCopyArtifactsOverride(
  override: ((data: CopyJobData) => Promise<CopyJobResult>) | null
): void {
  copyOverride = override;
}

/**
 * Queues a build for the Build Server and waits for Redis to acknowledge it.
 * queue.add() only resolves once Redis has stored the job, so a resolved add is the ack;
 * no ack within ENQUEUE_ACK_TIMEOUT_MS is treated as a failure.
 * The deployment ID doubles as the job ID, so a deployment can't be queued twice while pending.
 */
export async function enqueueBuild(data: BuildJobData): Promise<void> {
  const add = getBuildQueue().add('build', data, {
    jobId: data.deploymentId,
    // Job data holds encrypted env vars; don't keep it around after the build finishes
    removeOnComplete: true,
    removeOnFail: true,
  });
  // If the timeout wins, a late rejection must not become an unhandled rejection
  add.catch(() => {});

  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`Redis did not acknowledge build job within ${ENQUEUE_ACK_TIMEOUT_MS}ms`)),
      ENQUEUE_ACK_TIMEOUT_MS
    );
  });

  try {
    await Promise.race([add, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Asks the Build Server to copy S3 artifacts between prefixes (used for rollback snapshots)
 * and waits for the result.
 */
export async function copyArtifactsViaBuildServer(
  sourcePrefix: string,
  destinationPrefix: string
): Promise<CopyJobResult> {
  const data: CopyJobData = { sourcePrefix, destinationPrefix };
  if (copyOverride) {
    return copyOverride(data);
  }

  const queueEvents = await getCopyQueueEvents();
  const job = await getCopyQueue().add('copy', data, {
    // Kept briefly so waitUntilFinished can still read the result if the job finishes first
    removeOnComplete: { age: 3600 },
    removeOnFail: { age: 3600 },
  });

  return job.waitUntilFinished(queueEvents, COPY_TIMEOUT_MS);
}

export async function closeBuildQueues(): Promise<void> {
  await Promise.all([buildQueue?.close(), copyQueue?.close(), copyQueueEvents?.close()]);
  buildQueue = null;
  copyQueue = null;
  copyQueueEvents = null;
}
