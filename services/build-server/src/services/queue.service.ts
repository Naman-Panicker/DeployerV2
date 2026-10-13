import { Worker } from 'bullmq';
import { prisma, DeploymentStatus } from '@deployer/prisma';
import { decryptEnvVars } from '@deployer/crypto';
import {
  BUILD_QUEUE,
  COPY_QUEUE,
  getRedisConnection,
  type BuildJobData,
  type CopyJobData,
  type CopyJobResult,
} from '@deployer/queue';
import { generatePresignedForms, copyArtifactsInS3 } from './s3.service.js';
import { runBuildInContainer, abortActiveBuilds } from './docker.service.js';
import { classifyContainerFailure, classifyServerError, failDeployment } from './failure.service.js';
import { publishLog } from './log-publisher.service.js';

const MAX_CONCURRENT_BUILDS = 3;
const MAX_CONCURRENT_COPIES = 2;

let buildWorker: Worker<BuildJobData> | null = null;
let copyWorker: Worker<CopyJobData, CopyJobResult> | null = null;

/**
 * Starts the Redis-backed workers that consume build and artifact copy jobs.
 */
export function startWorkers(): void {
  if (buildWorker || copyWorker) return;

  buildWorker = new Worker<BuildJobData>(BUILD_QUEUE, (job) => processJob(job.data), {
    connection: getRedisConnection({ blocking: true }),
    concurrency: MAX_CONCURRENT_BUILDS,
  });

  copyWorker = new Worker<CopyJobData, CopyJobResult>(COPY_QUEUE, (job) => processCopyJob(job.data), {
    connection: getRedisConnection({ blocking: true }),
    concurrency: MAX_CONCURRENT_COPIES,
  });

  buildWorker.on('active', (job) => {
    console.log(`[Queue] Picked up deployment ${job.data.deploymentId}`);
  });
  // processJob records its own failures; this only fires if the deployment couldn't even be claimed
  buildWorker.on('failed', (job, err) => {
    console.error(
      `[Maintenance] Build job for deployment ${job?.data.deploymentId} could not be processed (left QUEUED):`,
      err
    );
  });
  buildWorker.on('error', (err) => console.error('[Queue] Build worker error:', err.message));
  copyWorker.on('error', (err) => console.error('[Queue] Copy worker error:', err.message));

  console.log(
    `[Queue] Workers listening on '${BUILD_QUEUE}' (concurrency ${MAX_CONCURRENT_BUILDS}) and '${COPY_QUEUE}' (concurrency ${MAX_CONCURRENT_COPIES})`
  );
}

/**
 * Stops picking up new jobs, kills running build containers (recorded as SYSTEM_ERROR
 * failures) and waits for their jobs to finish recording.
 */
export async function stopWorkers(): Promise<void> {
  const closing = Promise.all([buildWorker?.close(), copyWorker?.close()]);
  await abortActiveBuilds();
  await closing;
  buildWorker = null;
  copyWorker = null;
}

async function processCopyJob(data: CopyJobData): Promise<CopyJobResult> {
  const { sourcePrefix, destinationPrefix } = data;
  console.log(`[Queue] CopyArtifacts requested from '${sourcePrefix}' to '${destinationPrefix}'`);

  if (!sourcePrefix || !destinationPrefix) {
    return {
      success: false,
      copiedCount: 0,
      errorMessage: 'Missing required fields: sourcePrefix and destinationPrefix are mandatory',
    };
  }

  return copyArtifactsInS3(sourcePrefix, destinationPrefix);
}

async function updateDeploymentStatus(
  deploymentId: string,
  status: DeploymentStatus,
  extras?: Record<string, any>
): Promise<void> {
  await prisma.deployment.update({
    where: { id: deploymentId },
    data: { status, ...extras },
  });
  console.log(`[Deployment ${deploymentId}] Status updated to ${status}`);
}

async function processJob(job: BuildJobData): Promise<void> {
  const { projectId, deploymentId, repoUrl, branch, envVarsEncrypted } = job;

  // 1. Claim the deployment: only a QUEUED deployment may start building. This makes the job
  // idempotent when BullMQ re-delivers it (stalled job) or the gateway already marked it FAILED.
  const claimed = await prisma.deployment.updateMany({
    where: { id: deploymentId, status: DeploymentStatus.QUEUED },
    data: { status: DeploymentStatus.BUILDING, startedAt: new Date() },
  });
  if (claimed.count === 0) {
    console.warn(`[Queue] Skipping job for deployment ${deploymentId}: deployment is no longer QUEUED`);
    return;
  }
  console.log(`[Deployment ${deploymentId}] Status updated to ${DeploymentStatus.BUILDING}`);

  let stage = 'setup';
  try {
    const envVars = decryptEnvVars(envVarsEncrypted || {});

    // 2. Generate presigned S3 POST forms (outputs + history prefixes)
    console.log(`[Queue] Generating presigned S3 POST forms for deployment ${deploymentId}...`);
    const presignedForms = await generatePresignedForms(projectId, deploymentId);

    // 3. Run isolated build container (cloning, building, and S3 upload happen inside container)
    console.log(`[Queue] Launching build container for deployment ${deploymentId}...`);
    const buildResult = await runBuildInContainer({
      projectId,
      deploymentId,
      repoUrl,
      branch,
      envVars,
      presignedForms,
      // Scrubbed container output goes to the user's live log via Redis
      onLog: (stream, line) => {
        void publishLog(deploymentId, stream, line);
      },
    });

    if (!buildResult.success) {
      await failDeployment(deploymentId, classifyContainerFailure(buildResult));
      return;
    }

    // 4. Mark deployment as DEPLOYED
    stage = 'finalize';
    const s3Prefix = presignedForms.outputs.prefix;
    await updateDeploymentStatus(deploymentId, DeploymentStatus.DEPLOYED, {
      s3Prefix,
      completedAt: new Date(),
    });

    // Update project currentDeploymentId pointer
    await prisma.project.update({
      where: { id: projectId },
      data: { currentDeploymentId: deploymentId },
    });

    await publishLog(deploymentId, 'system', 'BUILD_COMPLETE');
    console.log(`[Queue] Deployment ${deploymentId} successfully completed and deployed!`);
  } catch (err) {
    await failDeployment(deploymentId, classifyServerError(stage, err));
  }
}
