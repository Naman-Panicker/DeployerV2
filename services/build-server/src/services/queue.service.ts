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
import { runBuildInContainer } from './docker.service.js';

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
  buildWorker.on('failed', (job, err) => {
    console.error(`[Queue] Unhandled exception in job ${job?.data.deploymentId}:`, err);
  });
  buildWorker.on('error', (err) => console.error('[Queue] Build worker error:', err.message));
  copyWorker.on('error', (err) => console.error('[Queue] Copy worker error:', err.message));

  console.log(
    `[Queue] Workers listening on '${BUILD_QUEUE}' (concurrency ${MAX_CONCURRENT_BUILDS}) and '${COPY_QUEUE}' (concurrency ${MAX_CONCURRENT_COPIES})`
  );
}

/**
 * Stops picking up new jobs and waits for active ones to finish.
 */
export async function stopWorkers(): Promise<void> {
  await Promise.all([buildWorker?.close(), copyWorker?.close()]);
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

async function notifyLogService(
  logServiceUrl: string,
  deploymentId: string,
  stream: 'stdout' | 'stderr' | 'system',
  line: string
): Promise<void> {
  try {
    await fetch(`${logServiceUrl}/api/logs/ingest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deploymentId,
        stream,
        line,
        timestamp: new Date().toISOString(),
      }),
    });
  } catch {
    // Ignore logging failures to avoid masking underlying build errors
  }
}

async function processJob(job: BuildJobData): Promise<void> {
  const { projectId, deploymentId, repoUrl, branch, envVarsEncrypted } = job;
  const envVars = decryptEnvVars(envVarsEncrypted || {});
  const logServiceUrl = process.env.LOG_SERVICE_URL || 'http://log-service:9003';

  try {
    // 1. Transition directly to BUILDING
    await updateDeploymentStatus(deploymentId, DeploymentStatus.BUILDING, { startedAt: new Date() });

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
      logServiceUrl,
    });

    if (!buildResult.success) {
      throw new Error(`Build container failed: ${buildResult.error || 'Non-zero exit code'}`);
    }

    // 4. Mark deployment as DEPLOYED
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

    console.log(`[Queue] Deployment ${deploymentId} successfully completed and deployed!`);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`[Queue] Build failed for deployment ${deploymentId}: ${errorMsg}`);

    // Notify log service in case container died prematurely
    await notifyLogService(logServiceUrl, deploymentId, 'stderr', `❌ Build failed: ${errorMsg}`);
    await notifyLogService(logServiceUrl, deploymentId, 'system', 'BUILD_COMPLETE');

    await updateDeploymentStatus(deploymentId, DeploymentStatus.FAILED, {
      completedAt: new Date(),
    });
  }
}
