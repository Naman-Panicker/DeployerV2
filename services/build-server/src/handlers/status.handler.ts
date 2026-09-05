import type { ServerUnaryCall, sendUnaryData } from '@grpc/grpc-js';
import type { GetBuildStatusRequest, GetBuildStatusResponse } from '@deployer/proto';
import { prisma } from '@deployer/prisma';

export async function handleGetBuildStatus(
  call: ServerUnaryCall<GetBuildStatusRequest, GetBuildStatusResponse>,
  callback: sendUnaryData<GetBuildStatusResponse>
): Promise<void> {
  const { deploymentId } = call.request;

  if (!deploymentId) {
    callback(null, {
      deploymentId: '',
      status: 'UNKNOWN',
    });
    return;
  }

  try {
    const deployment = await prisma.deployment.findUnique({
      where: { id: deploymentId },
    });

    callback(null, {
      deploymentId,
      status: deployment?.status || 'NOT_FOUND',
    });
  } catch (err) {
    console.error(`[Build Server RPC] GetBuildStatus failed for ${deploymentId}:`, err);
    callback(null, {
      deploymentId,
      status: 'ERROR',
    });
  }
}
