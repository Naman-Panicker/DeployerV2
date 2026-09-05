import type { ServerUnaryCall, sendUnaryData } from '@grpc/grpc-js';
import type { TriggerBuildRequest, TriggerBuildResponse } from '@deployer/proto';
import { enqueueBuild } from '../services/queue.service.js';

export async function handleTriggerBuild(
  call: ServerUnaryCall<TriggerBuildRequest, TriggerBuildResponse>,
  callback: sendUnaryData<TriggerBuildResponse>
): Promise<void> {
  const { projectId, deploymentId, repoUrl, branch, envVars } = call.request;

  console.log(`[Build Server RPC] TriggerBuild: project=${projectId}, deployment=${deploymentId}`);

  if (!projectId || !deploymentId || !repoUrl) {
    callback(null, {
      accepted: false,
      message: 'Missing required parameters: projectId, deploymentId, and repoUrl are required',
    });
    return;
  }

  // Push job to queue — runs asynchronously in background
  enqueueBuild({
    projectId,
    deploymentId,
    repoUrl,
    branch: branch || 'main',
    envVars: envVars || {},
  });

  callback(null, {
    accepted: true,
    message: `Build successfully queued for deployment ${deploymentId}`,
  });
}
