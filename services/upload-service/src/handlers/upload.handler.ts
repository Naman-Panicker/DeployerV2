import type { ServerUnaryCall, sendUnaryData } from '@grpc/grpc-js';
import type {
  UploadRequest,
  UploadResponse,
  CopyArtifactsRequest,
  CopyArtifactsResponse,
} from '@deployer/proto';
import { uploadArtifactsToS3, copyArtifactsInS3 } from '../services/s3.service.js';

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

export async function handleCopyArtifacts(
  call: ServerUnaryCall<CopyArtifactsRequest, CopyArtifactsResponse>,
  callback: sendUnaryData<CopyArtifactsResponse>
): Promise<void> {
  const { sourcePrefix, destinationPrefix } = call.request;

  console.log(
    `[Upload Service RPC] CopyArtifacts requested from '${sourcePrefix}' to '${destinationPrefix}'`
  );

  if (!sourcePrefix || !destinationPrefix) {
    callback(null, {
      success: false,
      errorMessage: 'Missing required fields: source_prefix and destination_prefix are mandatory',
      copiedCount: 0,
    });
    return;
  }

  const result = await copyArtifactsInS3(sourcePrefix, destinationPrefix);

  if (!result.success) {
    callback(null, {
      success: false,
      errorMessage: result.errorMessage || 'Failed to copy artifacts in S3',
      copiedCount: 0,
    });
    return;
  }

  callback(null, {
    success: true,
    errorMessage: '',
    copiedCount: result.copiedCount,
  });
}

