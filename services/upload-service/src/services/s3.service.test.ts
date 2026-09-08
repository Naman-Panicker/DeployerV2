import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const mockSend = vi.fn();

vi.mock('@aws-sdk/client-s3', () => {
  return {
    S3Client: class {
      send = mockSend;
    },
    HeadBucketCommand: class {
      constructor(public input: any) {}
    },
    CreateBucketCommand: class {
      constructor(public input: any) {}
    },
    PutObjectCommand: class {
      constructor(public input: any) {}
    },
    ListObjectsV2Command: class {
      constructor(public input: any) {}
    },
    CopyObjectCommand: class {
      constructor(public input: any) {}
    },
  };
});

import { env } from '@deployer/config';
import { uploadArtifactsToS3, copyArtifactsInS3 } from './s3.service.js';

describe('s3.service', () => {
  let tempDir: string;
  const originalKey = env.AWS_ACCESS_KEY_ID;
  const originalSecret = env.AWS_SECRET_ACCESS_KEY;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'deployer-s3-test-'));
    mockSend.mockReset();
    // Configure real-looking credentials to bypass placeholder simulation
    (env as any).AWS_ACCESS_KEY_ID = 'AKIA_TEST_KEY_12345';
    (env as any).AWS_SECRET_ACCESS_KEY = 'TEST_SECRET_KEY_abc1234567890';
  });

  afterEach(async () => {
    (env as any).AWS_ACCESS_KEY_ID = originalKey;
    (env as any).AWS_SECRET_ACCESS_KEY = originalSecret;
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('uploadArtifactsToS3', () => {
    it('uploads all files in directory to live and history S3 keys', async () => {
      // Create test files
      await fs.writeFile(path.join(tempDir, 'index.html'), '<h1>Hello Deployer</h1>');
      await fs.mkdir(path.join(tempDir, 'assets'));
      await fs.writeFile(path.join(tempDir, 'assets', 'style.css'), 'body { margin: 0; }');

      mockSend.mockResolvedValue({});

      const result = await uploadArtifactsToS3(
        'proj-123',
        'dep-456',
        tempDir,
        false // don't cleanup tempDir immediately so assertions succeed
      );

      expect(result.success).toBe(true);
      expect(result.uploadedCount).toBe(2);
      expect(result.s3Prefix).toBe('__outputs/proj-123/');

      // 2 files x 2 (live + history) = 4 PutObjectCommand calls
      expect(mockSend).toHaveBeenCalledTimes(4);

      const capturedKeys = mockSend.mock.calls.map((call) => call[0].input.Key);
      expect(capturedKeys).toContain('__outputs/proj-123/index.html');
      expect(capturedKeys).toContain('__history/proj-123/dep-456/index.html');
      expect(capturedKeys).toContain('__outputs/proj-123/assets/style.css');
      expect(capturedKeys).toContain('__history/proj-123/dep-456/assets/style.css');
    });

    it('returns error when source directory does not exist', async () => {
      const nonExistent = path.join(tempDir, 'does-not-exist');
      const result = await uploadArtifactsToS3('proj-1', 'dep-1', nonExistent);

      expect(result.success).toBe(false);
      expect(result.uploadedCount).toBe(0);
      expect(result.errorMessage).toMatch(/Source directory does not exist/i);
    });

    it('handles empty directory without sending commands', async () => {
      const result = await uploadArtifactsToS3('proj-empty', 'dep-empty', tempDir);

      expect(result.success).toBe(true);
      expect(result.uploadedCount).toBe(0);
      expect(mockSend).not.toHaveBeenCalled();
    });
  });

  describe('copyArtifactsInS3', () => {
    it('lists and copies all objects from source to destination prefix', async () => {
      mockSend
        // First call: ListObjectsV2Command
        .mockResolvedValueOnce({
          Contents: [
            { Key: '__history/p1/d1/' }, // prefix root itself (should be filtered out)
            { Key: '__history/p1/d1/index.html' },
            { Key: '__history/p1/d1/assets/main.js' },
          ],
          IsTruncated: false,
        })
        // Next calls: CopyObjectCommand
        .mockResolvedValue({});

      const result = await copyArtifactsInS3(
        '__history/p1/d1/',
        '__outputs/p1/'
      );

      expect(result.success).toBe(true);
      expect(result.copiedCount).toBe(2);

      // 1 List call + 2 Copy calls = 3 calls
      expect(mockSend).toHaveBeenCalledTimes(3);
    });

    it('returns error when no objects exist under source prefix', async () => {
      mockSend.mockResolvedValueOnce({
        Contents: [],
        IsTruncated: false,
      });

      const result = await copyArtifactsInS3(
        '__history/empty/prefix/',
        '__outputs/empty/'
      );

      expect(result.success).toBe(false);
      expect(result.copiedCount).toBe(0);
      expect(result.errorMessage).toMatch(/No artifacts found/i);
    });

    it('simulates copy when AWS credentials are not configured', async () => {
      (env as any).AWS_ACCESS_KEY_ID = '';
      (env as any).AWS_SECRET_ACCESS_KEY = '';

      const result = await copyArtifactsInS3('src/', 'dest/');
      expect(result.success).toBe(true);
      expect(result.copiedCount).toBe(1);
      expect(mockSend).not.toHaveBeenCalled();
    });
  });
});
