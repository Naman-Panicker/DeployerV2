import { prisma, DeploymentStatus, TriggerType, type Deployment } from '@deployer/prisma';

/**
 * Triggers a deployment for a user's project.
 * Creates a Deployment record with status QUEUED.
 * The gRPC call to the Build Server is stubbed until Phase 3.
 */
export async function triggerDeploy(
  userId: string,
  projectId: string,
  triggerType: TriggerType = TriggerType.MANUAL,
  commitHash?: string
): Promise<Deployment> {
  const project = await prisma.project.findFirst({
    where: { id: projectId, userId },
  });

  if (!project) {
    throw new Error('Project not found or unauthorized');
  }

  const deployment = await prisma.deployment.create({
    data: {
      projectId: project.id,
      status: DeploymentStatus.QUEUED,
      triggerType,
      commitHash: commitHash || null,
    },
  });

  console.log(
    `[API Gateway] Deployment created (${deployment.id}) for project ${project.id} [${project.name}] - Status: QUEUED`
  );

  // Decrypt env vars stored encrypted at rest
  let envVars: Record<string, string> = {};
  if (project.envVarsEncrypted && typeof project.envVarsEncrypted === 'object') {
    const { decryptEnvVars } = await import('./encryption.service.js');
    envVars = decryptEnvVars(project.envVarsEncrypted as Record<string, string>);
  }

  // Call Build Server via gRPC
  try {
    const { triggerBuildRpc } = await import('../clients/build.client.js');
    const buildResponse = await triggerBuildRpc({
      projectId: project.id,
      deploymentId: deployment.id,
      repoUrl: project.repoUrl,
      branch: project.branch || 'main',
      envVars,
    });

    console.log(
      `[API Gateway] Build Server response for deployment ${deployment.id}: accepted=${buildResponse.accepted}, message="${buildResponse.message}"`
    );
  } catch (err) {
    console.error(`[API Gateway] Failed to trigger build on Build Server:`, err);
  }

  return deployment;
}

/**
 * Triggers a rollback to an existing successful deployment.
 */
export async function triggerRollback(
  userId: string,
  projectId: string,
  targetDeploymentId: string
): Promise<Deployment> {
  const project = await prisma.project.findFirst({
    where: { id: projectId, userId },
  });

  if (!project) {
    throw new Error('Project not found or unauthorized');
  }

  const targetDeployment = await prisma.deployment.findFirst({
    where: {
      id: targetDeploymentId,
      projectId: project.id,
    },
  });

  if (!targetDeployment) {
    throw new Error('Target deployment not found for this project');
  }

  if (targetDeployment.status !== DeploymentStatus.DEPLOYED) {
    throw new Error(
      `Cannot rollback to deployment with status '${targetDeployment.status}'. Must be '${DeploymentStatus.DEPLOYED}'`
    );
  }

  const rollbackDeployment = await prisma.deployment.create({
    data: {
      projectId: project.id,
      status: DeploymentStatus.QUEUED,
      triggerType: TriggerType.ROLLBACK,
      commitHash: targetDeployment.commitHash,
      startedAt: new Date(),
    },
  });

  const sourcePrefix = `__history/${project.id}/${targetDeployment.id}/`;
  const destinationPrefix = `__outputs/${project.id}/`;

  console.log(
    `[API Gateway] Initiating rollback (${rollbackDeployment.id}) to target deployment ${targetDeployment.id} (copying ${sourcePrefix} -> ${destinationPrefix})`
  );

  try {
    const { copyArtifactsViaUploadService } = await import('../clients/upload.client.js');
    const copyResult = await copyArtifactsViaUploadService(sourcePrefix, destinationPrefix);

    if (!copyResult.success) {
      const errorMsg = copyResult.errorMessage || 'Failed to restore snapshot artifacts';
      await prisma.deployment.update({
        where: { id: rollbackDeployment.id },
        data: {
          status: DeploymentStatus.FAILED,
          completedAt: new Date(),
        },
      });
      throw new Error(`Rollback failed: ${errorMsg}`);
    }

    const completedDeployment = await prisma.deployment.update({
      where: { id: rollbackDeployment.id },
      data: {
        status: DeploymentStatus.DEPLOYED,
        s3Prefix: destinationPrefix,
        completedAt: new Date(),
      },
    });

    await prisma.project.update({
      where: { id: project.id },
      data: {
        currentDeploymentId: rollbackDeployment.id,
      },
    });

    console.log(
      `[API Gateway] Rollback completed successfully: deployment ${completedDeployment.id} is now DEPLOYED`
    );

    return completedDeployment;
  } catch (err) {
    await prisma.deployment.update({
      where: { id: rollbackDeployment.id },
      data: {
        status: DeploymentStatus.FAILED,
        completedAt: new Date(),
      },
    });
    throw err;
  }
}

/**
 * Finds a project by repo URL and triggers a webhook-based deployment.
 */
export async function triggerWebhookDeploy(
  repoUrl: string,
  branch?: string,
  commitHash?: string
): Promise<Deployment | null> {
  // Normalize git URLs (remove .git suffix, trailing slashes, ensure standard format)
  const normalizedUrl = repoUrl.replace(/\.git$/, '').replace(/\/$/, '');

  const projects = await prisma.project.findMany({
    where: {
      OR: [
        { repoUrl: normalizedUrl },
        { repoUrl: `${normalizedUrl}.git` },
        { repoUrl: { contains: normalizedUrl, mode: 'insensitive' } },
      ],
    },
  });

  if (projects.length === 0) {
    console.log(`[API Gateway] Webhook received but no project matches repo URL: ${repoUrl}`);
    return null;
  }

  // Pick matching branch if specified, otherwise first project
  const project = branch
    ? projects.find((p) => p.branch === branch) || projects[0]
    : projects[0];

  const deployment = await prisma.deployment.create({
    data: {
      projectId: project.id,
      status: DeploymentStatus.QUEUED,
      triggerType: TriggerType.WEBHOOK,
      commitHash: commitHash || null,
    },
  });

  console.log(
    `[API Gateway] Webhook triggered deployment ${deployment.id} for project ${project.id} (${project.name})`
  );

  // Decrypt env vars stored encrypted at rest
  let envVars: Record<string, string> = {};
  if (project.envVarsEncrypted && typeof project.envVarsEncrypted === 'object') {
    const { decryptEnvVars } = await import('./encryption.service.js');
    envVars = decryptEnvVars(project.envVarsEncrypted as Record<string, string>);
  }

  // Call Build Server via gRPC
  try {
    const { triggerBuildRpc } = await import('../clients/build.client.js');
    const buildResponse = await triggerBuildRpc({
      projectId: project.id,
      deploymentId: deployment.id,
      repoUrl: project.repoUrl,
      branch: project.branch || 'main',
      envVars,
    });

    console.log(
      `[API Gateway] Webhook Build Server response for deployment ${deployment.id}: accepted=${buildResponse.accepted}, message="${buildResponse.message}"`
    );
  } catch (err) {
    console.error(`[API Gateway] Failed to trigger build on Build Server for webhook:`, err);
  }

  return deployment;
}
