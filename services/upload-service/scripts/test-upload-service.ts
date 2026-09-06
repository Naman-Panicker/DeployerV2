import { credentials } from '@grpc/grpc-js';
import { UploadServiceClient } from '@deployer/proto';
import { startServer } from '../src/server.js';

const TEST_PORT = 9015;

async function runUploadServiceTests() {
  console.log('========================================================');
  console.log('[Upload Service Test Suite] Starting Phase 6 verification...');
  console.log('========================================================');

  const server = await startServer(TEST_PORT);
  const client = new UploadServiceClient(`localhost:${TEST_PORT}`, credentials.createInsecure());

  try {
    // 1. Test validation on empty request for CopyArtifacts
    console.log('\n--- Test 1: CopyArtifacts Missing Fields Validation ---');
    await new Promise<void>((resolve, reject) => {
      client.copyArtifacts(
        { sourcePrefix: '', destinationPrefix: '' },
        (err, res) => {
          if (err) return reject(err);
          console.log('Validation response:', res);
          if (res.success !== false || !res.errorMessage.includes('mandatory')) {
            return reject(new Error('Expected CopyArtifacts validation failure for empty fields'));
          }
          console.log('  ✓ CopyArtifacts rejected empty fields correctly');
          resolve();
        }
      );
    });

    // 2. Test CopyArtifacts with mock/placeholder S3 credentials
    console.log('\n--- Test 2: CopyArtifacts Execution (Mock/Placeholder S3) ---');
    await new Promise<void>((resolve, reject) => {
      client.copyArtifacts(
        {
          sourcePrefix: '__history/proj-123/deploy-abc/',
          destinationPrefix: '__outputs/proj-123/',
        },
        (err, res) => {
          if (err) return reject(err);
          console.log('Copy response:', res);
          if (!res.success) {
            return reject(new Error(`Expected CopyArtifacts success, got: ${res.errorMessage}`));
          }
          console.log('  ✓ CopyArtifacts succeeded with copied count:', res.copiedCount);
          resolve();
        }
      );
    });

    // 3. Test CloneRepo RPC
    console.log('\n--- Test 3: CloneRepo RPC ---');
    await new Promise<void>((resolve, reject) => {
      client.cloneRepo(
        {
          repoUrl: 'https://github.com/octocat/Hello-World.git',
          branch: 'master',
          targetPath: '',
        },
        (err, res) => {
          if (err) return reject(err);
          console.log('Clone response:', res);
          if (!res.success) {
            return reject(new Error(`Expected CloneRepo success, got: ${res.errorMessage}`));
          }
          console.log('  ✓ CloneRepo succeeded:', res.clonePath);
          resolve();
        }
      );
    });

    console.log('\n========================================================');
    console.log('🎉 ALL UPLOAD SERVICE TESTS PASSED!');
    console.log('========================================================\n');
  } finally {
    client.close();
    server.forceShutdown();
  }
}

runUploadServiceTests().catch((err) => {
  console.error('\n❌ Upload Service Test Failed:', err);
  process.exit(1);
});
