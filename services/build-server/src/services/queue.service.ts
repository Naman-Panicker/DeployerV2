import fs from 'node:fs/promises';
import { prisma, DeploymentStatus } from '@deployer/prisma';
import { cloneViaUploadService, uploadViaUploadService } from '../clients/upload.client.js';
import { detectBuildConfig } from './detect.service.js';
import { runBuildInContainer, BUILD_IMAGE } from './docker.service.js';
import { publishLog, publishBuildComplete } from './redis.service.js';

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

async function processJob(job: BuildJob): Promise<void> {
  const { projectId, deploymentId, repoUrl, branch, envVars } = job;
  let clonePath: string | null = null;

  try {
    // ── 1. CLONING ──────────────────────────────────────────────────────────
    await updateDeploymentStatus(deploymentId, DeploymentStatus.CLONING, { startedAt: new Date() });
    await publishLog(deploymentId, 'stdout', `Initiating clone: ${repoUrl} (branch: ${branch})...`);

    const cloneResponse = await cloneViaUploadService(repoUrl, branch);
    if (!cloneResponse.success) {
      throw new Error(`Git clone failed: ${cloneResponse.errorMessage}`);
    }

    clonePath = cloneResponse.clonePath;
    await publishLog(deploymentId, 'stdout', `Repository cloned successfully to ${clonePath}`);

    // ── 2. DETECT BUILD CONFIG ──────────────────────────────────────────────
    const buildConfig = await detectBuildConfig(clonePath);
    await publishLog(
      deploymentId,
      'stdout',
      `Detected framework: ${buildConfig.framework} | Command: "${buildConfig.buildCommand}"`
    );

    // ── 3. BUILDING ─────────────────────────────────────────────────────────
    await updateDeploymentStatus(deploymentId, DeploymentStatus.BUILDING);
    await publishLog(deploymentId, 'stdout', `Starting build container (image: ${BUILD_IMAGE})...`);

    const buildResult = await runBuildInContainer({
      deploymentId,
      clonePath,
      buildCommand: buildConfig.buildCommand,
      envVars,
    });

    if (!buildResult.success) {
      throw new Error(`Build failed: ${buildResult.error || 'Non-zero exit code'}`);
    }

    const outputPath = buildConfig.resolveOutputPath(clonePath);
    await publishLog(deploymentId, 'stdout', `Build succeeded. Artifact directory: ${outputPath}`);

    // ── 4. UPLOADING ────────────────────────────────────────────────────────
    await updateDeploymentStatus(deploymentId, DeploymentStatus.UPLOADING);
    await publishLog(deploymentId, 'stdout', `Uploading build artifacts to S3 storage...`);

    const uploadResponse = await uploadViaUploadService(projectId, deploymentId, outputPath);
    if (!uploadResponse.success) {
      throw new Error(`Artifact upload failed: ${uploadResponse.errorMessage}`);
    }

    await publishLog(deploymentId, 'stdout', `Artifacts uploaded to S3: ${uploadResponse.s3Prefix}`);

    // ── 5. DEPLOYED ─────────────────────────────────────────────────────────
    await updateDeploymentStatus(deploymentId, DeploymentStatus.DEPLOYED, {
      s3Prefix: uploadResponse.s3Prefix,
      completedAt: new Date(),
    });

    // Update the project's currentDeploymentId pointer
    await prisma.project.update({
      where: { id: projectId },
      data: { currentDeploymentId: deploymentId },
    });

    await publishLog(
      deploymentId,
      'stdout',
      `✅ Deployment ${deploymentId} successfully completed and deployed!`
    );
    await publishBuildComplete(deploymentId);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`[Queue] Build failed for deployment ${deploymentId}: ${errorMsg}`);

    await publishLog(deploymentId, 'stderr', `❌ Build failed: ${errorMsg}`);
    await updateDeploymentStatus(deploymentId, DeploymentStatus.FAILED, {
      completedAt: new Date(),
    });
    await publishBuildComplete(deploymentId);
  } finally {
    // ── 6. CLEANUP ──────────────────────────────────────────────────────────
    if (clonePath) {
      try {
        await fs.rm(clonePath, { recursive: true, force: true });
        console.log(`[Queue] Cleaned up temporary clone directory: ${clonePath}`);
      } catch (cleanupErr) {
        console.warn(`[Queue] Failed to remove clone directory ${clonePath}:`, cleanupErr);
      }
    }
  }
}
