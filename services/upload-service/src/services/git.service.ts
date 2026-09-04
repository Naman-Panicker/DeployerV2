import { simpleGit } from 'simple-git';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';

export async function cloneRepository(
  repoUrl: string,
  branch: string = 'main',
  customTargetPath?: string
): Promise<{ success: boolean; clonePath: string; error?: string }> {
  let targetPath = customTargetPath;

  if (!targetPath) {
    const cloneId = crypto.randomUUID();
    targetPath = path.join(os.tmpdir(), 'deployer-clones', cloneId);
  }

  try {
    await fs.mkdir(targetPath, { recursive: true });

    const git = simpleGit();
    console.log(`[Upload Service] Cloning repo ${repoUrl} (branch: ${branch}) into ${targetPath}...`);

    // Perform shallow clone for speed and minimal disk usage
    await git.clone(repoUrl, targetPath, [
      '--branch',
      branch,
      '--depth',
      '1',
      '--single-branch',
    ]);

    console.log(`[Upload Service] Successfully cloned repository into ${targetPath}`);
    return { success: true, clonePath: targetPath };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[Upload Service] Git clone failed: ${message}`);

    // Clean up destination directory on failure if created
    if (targetPath) {
      try {
        await fs.rm(targetPath, { recursive: true, force: true });
      } catch {
        // Ignore cleanup error on failed clone
      }
    }

    return { success: false, clonePath: targetPath || '', error: message };
  }
}

export async function cleanupDirectory(dirPath: string): Promise<void> {
  try {
    await fs.rm(dirPath, { recursive: true, force: true });
    console.log(`[Upload Service] Cleaned up directory ${dirPath}`);
  } catch (err) {
    console.warn(`[Upload Service] Warning: Failed to cleanup ${dirPath}:`, err);
  }
}
