import { credentials } from '@grpc/grpc-js';
import { BuildServiceClient } from '@deployer/proto';
import type {
  TriggerBuildRequest,
  TriggerBuildResponse,
  GetBuildStatusRequest,
  GetBuildStatusResponse,
} from '@deployer/proto';
import { env } from '@deployer/config';

let client: InstanceType<typeof BuildServiceClient> | null = null;

function getClient(): InstanceType<typeof BuildServiceClient> {
  if (!client) {
    const host = env.BUILD_SERVER_HOST || 'localhost';
    const port = env.BUILD_SERVER_PORT || 9001;
    const address = `${host}:${port}`;
    client = new BuildServiceClient(address, credentials.createInsecure());
    console.log(`[Build Client] Connected to Build Server at ${address}`);
  }
  return client;
}

/**
 * Triggers an asynchronous build on the Build Server via gRPC.
 */
export function triggerBuildRpc(request: TriggerBuildRequest): Promise<TriggerBuildResponse> {
  return new Promise((resolve, reject) => {
    getClient().triggerBuild(request, (err, response) => {
      if (err) return reject(err);
      resolve(response);
    });
  });
}

/**
 * Queries the Build Server for the current status of a deployment.
 */
export function getBuildStatusRpc(request: GetBuildStatusRequest): Promise<GetBuildStatusResponse> {
  return new Promise((resolve, reject) => {
    getClient().getBuildStatus(request, (err, response) => {
      if (err) return reject(err);
      resolve(response);
    });
  });
}
