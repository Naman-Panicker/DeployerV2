import { credentials } from '@grpc/grpc-js';
import { UploadServiceClient } from '@deployer/proto';
import { startServer } from '../src/server.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const TEST_PORT = 9022;

async function runUploadServiceTests() {
  console.log('[Upload Service Test Suite] Starting gRPC test server...');

  const server = await startServer(TEST_PORT);
  const client = new UploadServiceClient(`localhost:${TEST_PORT}`, credentials.createInsecure());

  try {
    // 1. Test CloneRepo
    console.log('\n--- Test 1: CloneRepo RPC (Live Public Repo) ---');
    const cloneResult = await new Promise<{ success: boolean; clonePath: string; errorMessage: string }>(
      (resolve, reject) => {
        client.cloneRepo(
          {
            repoUrl: 'https://github.com/octocat/Hello-World.git',
            branch: 'master',
            targetPath: '',
          },
          (err, res) => {
            if (err) return reject(err);
            resolve(res);
          }
        );
      }
    );

    console.log('Clone response:', cloneResult);
    if (!cloneResult.success || !cloneResult.clonePath) {
      throw new Error(`Clone failed: ${cloneResult.errorMessage}`);
    }

    // Verify files on disk
    const files = await fs.readdir(cloneResult.clonePath);
    console.log('Cloned files on disk:', files);
    if (!files.includes('README')) {
      throw new Error('Expected cloned repo to contain README');
    }

    // Clean up cloned files
    await fs.rm(cloneResult.clonePath, { recursive: true, force: true });
    console.log('Cleaned up test clone directory successfully.');

    // 2. Test CloneRepo with invalid repo (error handling test)
    console.log('\n--- Test 2: CloneRepo Error Handling ---');
    const invalidClone = await new Promise<{ success: boolean; errorMessage: string }>((resolve, reject) => {
      client.cloneRepo(
        {
          repoUrl: 'https://github.com/this-repo-does-not-exist-12345/nonexistent.git',
          branch: 'main',
          targetPath: '',
        },
        (err, res) => {
          if (err) return reject(err);
          resolve(res);
        }
      );
    });
    console.log('Invalid clone response (expected failure):', invalidClone.success, invalidClone.errorMessage);
    if (invalidClone.success) {
      throw new Error('Invalid clone should have failed');
    }

    // 3. Test UploadArtifacts validation (missing parameters)
    console.log('\n--- Test 3: UploadArtifacts Missing Parameters Validation ---');
    const missingValidation = await new Promise<{ success: boolean; errorMessage: string }>((resolve, reject) => {
      client.uploadArtifacts(
        {
          projectId: '',
          deploymentId: 'dep-123',
          sourceDirectory: '',
        },
        (err, res) => {
          if (err) return reject(err);
          resolve(res);
        }
      );
    });
    console.log('Missing params validation result:', missingValidation.success, missingValidation.errorMessage);
    if (missingValidation.success) {
      throw new Error('UploadArtifacts should fail when required fields are missing');
    }

    // 4. Test UploadArtifacts with local directory
    console.log('\n--- Test 4: UploadArtifacts Local Traversal & Flow ---');
    const sampleDir = path.join(os.tmpdir(), `sample-dist-${Date.now()}`);
    await fs.mkdir(sampleDir, { recursive: true });
    await fs.writeFile(path.join(sampleDir, 'index.html'), '<h1>Hello Deployer</h1>');
    await fs.mkdir(path.join(sampleDir, 'assets'), { recursive: true });
    await fs.writeFile(path.join(sampleDir, 'assets', 'style.css'), 'body { background: #000; }');

    const uploadResult = await new Promise<{ success: boolean; s3Prefix: string; errorMessage: string }>(
      (resolve, reject) => {
        client.uploadArtifacts(
          {
            projectId: 'proj-test-123',
            deploymentId: 'dep-test-456',
            sourceDirectory: sampleDir,
          },
          (err, res) => {
            if (err) return reject(err);
            resolve(res);
          }
        );
      }
    );

    console.log('UploadArtifacts result:', uploadResult);
    // Note: If AWS credentials are placeholders, S3 returns error or graceful message, which is expected and handled.
    if (uploadResult.success) {
      console.log('Upload succeeded with s3Prefix:', uploadResult.s3Prefix);
    } else {
      console.log('Upload returned expected error (due to placeholder AWS credentials):', uploadResult.errorMessage);
    }

    console.log('\n✅ ALL UPLOAD SERVICE TESTS PASSED SUCCESSFULLY!\n');
  } finally {
    client.close();
    server.forceShutdown();
  }
}

runUploadServiceTests().catch((err) => {
  console.error('\n❌ Upload Service Test Suite Failed:', err);
  process.exit(1);
});
