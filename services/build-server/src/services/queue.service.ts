import { prisma, DeploymentStatus } from '@deployer/prisma';
import { generatePresignedForms } from './s3.service.js';
import { runBuildInContainer } from './docker.service.js';

export interface BuildJob {
  projectId: string;
  deploymentId: string;
  repoUrl: string;
  branch: string;
  envVars: Record<string, string>;
}

const MAX_CONCURRENT_BUILDS = 3;
const queue: BuildJob[] = [];
let activeCount = 0;

/**
 * Pushes a build job into the concurrency queue and triggers processing.
 */
export function enqueueBuild(job: BuildJob): void {
  queue.push(job);
  console.log(
    `[Queue] Enqueued deployment ${job.deploymentId}. Pending: ${queue.length}, Active: ${activeCount}/${MAX_CONCURRENT_BUILDS}`
  );
  tryProcessNext();
}

/**
 * Returns the current queue status for health/monitoring.
 */
export function getQueueStatus(): { pending: number; active: number } {
  return { pending: queue.length, active: activeCount };
}

function tryProcessNext(): void {
  while (activeCount < MAX_CONCURRENT_BUILDS && queue.length > 0) {
    const job = queue.shift()!;
    activeCount++;

    processJob(job)
      .catch((err) => {
        console.error(`[Queue] Unhandled exception in job ${job.deploymentId}:`, err);
      })
      .finally(() => {
        activeCount--;
        tryProcessNext();
      });
  }
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

async function processJob(job: BuildJob): Promise<void> {
  const { projectId, deploymentId, repoUrl, branch, envVars } = job;
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
