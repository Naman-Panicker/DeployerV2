import { credentials } from '@grpc/grpc-js';
import { UploadServiceClient } from '@deployer/proto';
import type { CopyArtifactsRequest, CopyArtifactsResponse } from '@deployer/proto';
import { env } from '@deployer/config';

let client: InstanceType<typeof UploadServiceClient> | null = null;

export function setUploadClient(newClient: InstanceType<typeof UploadServiceClient> | null): void {
  client = newClient;
}

function getClient(): InstanceType<typeof UploadServiceClient> {
  if (!client) {
    const host = env.UPLOAD_SERVICE_HOST || 'localhost';
    const port = env.UPLOAD_SERVICE_PORT || 9002;
    const address = `${host}:${port}`;
    client = new UploadServiceClient(address, credentials.createInsecure());
    console.log(`[API Gateway Upload Client] Connected to Upload Service at ${address}`);
  }
  return client;
}

/**
 * Calls CopyArtifacts RPC on the Upload Service (used for rollback snapshots).
 */
export function copyArtifactsViaUploadService(
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
