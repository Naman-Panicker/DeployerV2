import { credentials } from '@grpc/grpc-js';
import { UploadServiceClient } from '@deployer/proto';
import { env } from '@deployer/config';

async function runTestClient() {
  const target = `localhost:${env.UPLOAD_SERVICE_PORT || 9002}`;
  console.log(`[Upload Service Test Client] Connecting to ${target}...`);

  const client = new UploadServiceClient(target, credentials.createInsecure());

  // 1. Test CloneRepo
  console.log('\n--- Test 1: CloneRepo RPC ---');
  const testRepo = 'https://github.com/octocat/Hello-World.git';

  await new Promise<void>((resolve, reject) => {
    client.cloneRepo(
      {
        repoUrl: testRepo,
        branch: 'master',
        targetPath: '',
      },
      (err, res) => {
        if (err) {
          console.error('[Test 1 Failed] gRPC error:', err);
          reject(err);
          return;
        }
        console.log('[Test 1 Result]:', res);
        if (res.success) {
          console.log(`[Test 1 Passed] Successfully cloned to: ${res.clonePath}`);
        } else {
          console.warn(`[Test 1 Returned Failure]: ${res.errorMessage}`);
        }
        resolve();
      }
    );
  });

  // 2. Test UploadArtifacts (with missing args check)
  console.log('\n--- Test 2: UploadArtifacts RPC Validation ---');
  await new Promise<void>((resolve) => {
    client.uploadArtifacts(
      {
        projectId: '',
        deploymentId: '',
        sourceDirectory: '',
      },
      (err, res) => {
        console.log('[Test 2 Validation Result]:', res || err);
        resolve();
      }
    );
  });

  // 3. Test CopyArtifacts (with missing args check)
  console.log('\n--- Test 3: CopyArtifacts RPC Validation ---');
  await new Promise<void>((resolve) => {
    client.copyArtifacts(
      {
        sourcePrefix: '',
        destinationPrefix: '',
      },
      (err, res) => {
        console.log('[Test 3 Validation Result]:', res || err);
        resolve();
      }
    );
  });

  console.log('\n[Upload Service Test Client] Tests completed.');
  client.close();
}


runTestClient().catch((err) => {
  console.error('[Upload Service Test Client] Error:', err);
  process.exit(1);
});
