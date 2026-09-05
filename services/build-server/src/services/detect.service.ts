import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';

export interface BuildConfig {
  buildCommand: string;
  outputDir: string;
  framework: string;
  /** Resolves the absolute output directory path after the build completes */
  resolveOutputPath: (clonePath: string) => string;
}

/**
 * Inspects the cloned repository at clonePath to detect the framework,
 * build command, and output artifact directory.
 */
export async function detectBuildConfig(clonePath: string): Promise<BuildConfig> {
  const packageJsonPath = path.join(clonePath, 'package.json');

  try {
    const rawContent = await fs.readFile(packageJsonPath, 'utf-8');
    const packageJson = JSON.parse(rawContent);

    const hasBuildScript = Boolean(packageJson.scripts?.build);
    const allDeps: Record<string, string> = {
      ...(packageJson.dependencies || {}),
      ...(packageJson.devDependencies || {}),
    };

    if (!hasBuildScript) {
      console.log('[Detect] No build script found in package.json — treating as static project');
      return {
        buildCommand: 'echo "No build step needed"',
        outputDir: '.',
        framework: 'static',
        resolveOutputPath: (cp) => cp,
      };
    }

    // 1. Vite detection
    if (allDeps['vite']) {
      console.log('[Detect] Detected Vite framework');
      return {
        buildCommand: 'npm install && npm run build',
        outputDir: 'dist',
        framework: 'vite',
        resolveOutputPath: (cp) => path.join(cp, 'dist'),
      };
    }

    // 2. Create React App (react-scripts)
    if (allDeps['react-scripts']) {
      console.log('[Detect] Detected Create React App framework');
      return {
        buildCommand: 'npm install && npm run build',
        outputDir: 'build',
        framework: 'create-react-app',
        resolveOutputPath: (cp) => path.join(cp, 'build'),
      };
    }

    // 3. Generic project with npm build script
    console.log('[Detect] Detected generic build script — output directory will be discovered post-build');
    return {
      buildCommand: 'npm install && npm run build',
      outputDir: 'dist',
      framework: 'generic',
      resolveOutputPath: (cp) => {
        const candidates = ['dist', 'build', 'out', 'public'];
        for (const candidate of candidates) {
          const candidatePath = path.join(cp, candidate);
          try {
            if (fsSync.existsSync(candidatePath) && fsSync.statSync(candidatePath).isDirectory()) {
              return candidatePath;
            }
          } catch {
            // continue checking
          }
        }
        return cp;
      },
    };
  } catch {
    // No package.json or invalid JSON
    console.log('[Detect] No package.json detected — deploying repo root as static website');
    return {
      buildCommand: 'echo "No build step needed"',
      outputDir: '.',
      framework: 'static',
      resolveOutputPath: (cp) => cp,
    };
  }
}
