import type { ServerUnaryCall, sendUnaryData } from '@grpc/grpc-js';
import type { UploadRequest, UploadResponse } from '@deployer/proto';
import { uploadArtifactsToS3 } from '../services/s3.service.js';

export async function handleUploadArtifacts(
  call: ServerUnaryCall<UploadRequest, UploadResponse>,
  callback: sendUnaryData<UploadResponse>
): Promise<void> {
  const { projectId, deploymentId, sourceDirectory } = call.request;

  console.log(
    `[Upload Service RPC] UploadArtifacts requested for project: ${projectId}, deployment: ${deploymentId}, source: ${sourceDirectory}`
  );

  if (!projectId || !deploymentId || !sourceDirectory) {
    callback(null, {
      success: false,
      errorMessage: 'Missing required fields: project_id, deployment_id, and source_directory are mandatory',
      s3Prefix: '',
    });
    return;
  }

  const result = await uploadArtifactsToS3(projectId, deploymentId, sourceDirectory);

  if (!result.success) {
    callback(null, {
      success: false,
      errorMessage: result.errorMessage || 'Failed to upload artifacts to S3',
      s3Prefix: '',
    });
    return;
  }

  callback(null, {
    success: true,
    errorMessage: '',
    s3Prefix: result.s3Prefix,
  });
}
