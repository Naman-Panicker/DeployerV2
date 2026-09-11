import { credentials } from '@grpc/grpc-js';
import { BuildServiceClient } from '@deployer/proto';
import type { CopyArtifactsRequest, CopyArtifactsResponse } from '@deployer/proto';
import { env } from '@deployer/config';

let client: InstanceType<typeof BuildServiceClient> | null = null;

export function setCopyClient(newClient: InstanceType<typeof BuildServiceClient> | null): void {
  client = newClient;
}

function getClient(): InstanceType<typeof BuildServiceClient> {
  if (!client) {
    const host = env.BUILD_SERVER_HOST || 'localhost';
    const port = env.BUILD_SERVER_PORT || 9001;
    const address = `${host}:${port}`;
    client = new BuildServiceClient(address, credentials.createInsecure());
    console.log(`[API Gateway Copy Client] Connected to Build Server at ${address}`);
  }
  return client;
}

/**
 * Calls CopyArtifacts RPC on the Build Server (used for rollback snapshots).
 */
export function copyArtifactsViaBuildServer(
  sourcePrefix: string,
  destinationPrefix: string
): Promise<CopyArtifactsResponse> {
  return new Promise((resolve, reject) => {
    const request: CopyArtifactsRequest = {
      sourcePrefix,
      destinationPrefix,
    };

    getClient().copyArtifacts(request, (err, response) => {
      if (err) return reject(err);
      resolve(response);
    });
  });
}
