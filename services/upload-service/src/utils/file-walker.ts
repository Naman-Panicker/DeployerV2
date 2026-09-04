import fs from 'node:fs/promises';
import path from 'node:path';

export interface FileItem {
  absolutePath: string;
  relativePath: string;
  size: number;
}

/**
 * Recursively walks a directory and collects all files,
 * ignoring `.git` directories.
 */
export async function walkDirectory(
  dir: string,
  baseDir: string = dir
): Promise<FileItem[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files: FileItem[] = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    // Skip git repository metadata and hidden temp files
    if (entry.name === '.git' || entry.name === '.DS_Store') {
      continue;
    }

    if (entry.isDirectory()) {
      const nestedFiles = await walkDirectory(fullPath, baseDir);
      files.push(...nestedFiles);
    } else if (entry.isFile()) {
      const stats = await fs.stat(fullPath);
      const relativePath = path.relative(baseDir, fullPath).replace(/\\/g, '/');
      files.push({
        absolutePath: fullPath,
        relativePath,
        size: stats.size,
      });
    }
  }

  return files;
}
