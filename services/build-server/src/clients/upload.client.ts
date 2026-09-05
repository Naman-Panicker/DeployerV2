import { credentials } from '@grpc/grpc-js';
import { UploadServiceClient } from '@deployer/proto';
import type { CloneResponse, UploadResponse } from '@deployer/proto';
import { env } from '@deployer/config';

let client: InstanceType<typeof UploadServiceClient> | null = null;

export function setUploadClient(newClient: InstanceType<typeof UploadServiceClient> | null): void {
  client = newClient;
}

function getClient(): InstanceType<typeof UploadServiceClient> {
  if (!client) {
    const port = process.env.UPLOAD_SERVICE_PORT || env.UPLOAD_SERVICE_PORT || 9002;
    const address = `localhost:${port}`;
    client = new UploadServiceClient(address, credentials.createInsecure());
    console.log(`[Upload Client] Connected to Upload Service at ${address}`);
  }
  return client;
}

/**
 * Invokes the CloneRepo RPC on the Upload Service.
 */
export function cloneViaUploadService(
  repoUrl: string,
  branch: string,
  targetPath?: string
): Promise<CloneResponse> {
  return new Promise((resolve, reject) => {
    getClient().cloneRepo(
      { repoUrl, branch, targetPath: targetPath || '' },
      (err, response) => {
        if (err) return reject(err);
        resolve(response);
      }
    );
  });
}

/**
 * Invokes the UploadArtifacts RPC on the Upload Service to push dist/ to S3.
 */
export function uploadViaUploadService(
  projectId: string,
  deploymentId: string,
  sourceDirectory: string
): Promise<UploadResponse> {
  return new Promise((resolve, reject) => {
    getClient().uploadArtifacts(
      { projectId, deploymentId, sourceDirectory },
      (err, response) => {
        if (err) return reject(err);
        resolve(response);
      }
    );
  });
}
