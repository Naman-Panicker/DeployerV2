import type { ServerUnaryCall, sendUnaryData } from '@grpc/grpc-js';
import type { CloneRequest, CloneResponse } from '@deployer/proto';
import { cloneRepository } from '../services/git.service.js';

export async function handleCloneRepo(
  call: ServerUnaryCall<CloneRequest, CloneResponse>,
  callback: sendUnaryData<CloneResponse>
): Promise<void> {
  const { repoUrl, branch, targetPath } = call.request;

  console.log(`[Upload Service RPC] CloneRepo requested for: ${repoUrl} (branch: ${branch || 'main'})`);

  if (!repoUrl) {
    callback(null, {
      success: false,
      errorMessage: 'Missing repo_url in CloneRequest',
      clonePath: '',
    });
    return;
  }

  const result = await cloneRepository(repoUrl, branch || 'main', targetPath || undefined);

  if (!result.success) {
    callback(null, {
      success: false,
      errorMessage: result.error || 'Failed to clone repository',
      clonePath: result.clonePath,
    });
    return;
  }

  callback(null, {
    success: true,
    errorMessage: '',
    clonePath: result.clonePath,
  });
}
