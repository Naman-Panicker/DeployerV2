import type { ServerUnaryCall, sendUnaryData } from '@grpc/grpc-js';
import type { CopyArtifactsRequest, CopyArtifactsResponse } from '@deployer/proto';
import { copyArtifactsInS3 } from '../services/s3.service.js';

export async function handleCopyArtifacts(
  call: ServerUnaryCall<CopyArtifactsRequest, CopyArtifactsResponse>,
  callback: sendUnaryData<CopyArtifactsResponse>
): Promise<void> {
  const { sourcePrefix, destinationPrefix } = call.request;

  console.log(
    `[Build Server RPC] CopyArtifacts requested from '${sourcePrefix}' to '${destinationPrefix}'`
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
