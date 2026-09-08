import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { detectBuildConfig } from './detect.service.js';

describe('detect.service', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'deployer-detect-test-'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('detects Vite project when vite is in dependencies', async () => {
    const pkg = {
      name: 'vite-app',
      scripts: { build: 'vite build' },
      dependencies: { vite: '^5.0.0', react: '^18.0.0' },
    };
    await fs.writeFile(path.join(tempDir, 'package.json'), JSON.stringify(pkg));

    const config = await detectBuildConfig(tempDir);
    expect(config.framework).toBe('vite');
    expect(config.outputDir).toBe('dist');
    expect(config.buildCommand).toBe('npm install && npm run build');
    expect(config.resolveOutputPath(tempDir)).toBe(path.join(tempDir, 'dist'));
  });

  it('detects Vite project when vite is in devDependencies', async () => {
    const pkg = {
      name: 'vite-app-dev',
      scripts: { build: 'vite build' },
      devDependencies: { vite: '^5.0.0' },
    };
    await fs.writeFile(path.join(tempDir, 'package.json'), JSON.stringify(pkg));

    const config = await detectBuildConfig(tempDir);
    expect(config.framework).toBe('vite');
  });

  it('detects Create React App when react-scripts is present', async () => {
    const pkg = {
      name: 'cra-app',
      scripts: { build: 'react-scripts build' },
      dependencies: { 'react-scripts': '^5.0.1' },
    };
    await fs.writeFile(path.join(tempDir, 'package.json'), JSON.stringify(pkg));

    const config = await detectBuildConfig(tempDir);
    expect(config.framework).toBe('create-react-app');
    expect(config.outputDir).toBe('build');
    expect(config.buildCommand).toBe('npm install && npm run build');
    expect(config.resolveOutputPath(tempDir)).toBe(path.join(tempDir, 'build'));
  });

  it('falls back to generic framework when scripts.build exists without specific frameworks', async () => {
    const pkg = {
      name: 'generic-app',
      scripts: { build: 'webpack --mode production' },
      dependencies: { lodash: '^4.17.21' },
    };
    await fs.writeFile(path.join(tempDir, 'package.json'), JSON.stringify(pkg));

    const config = await detectBuildConfig(tempDir);
    expect(config.framework).toBe('generic');
    expect(config.outputDir).toBe('dist');
    expect(config.buildCommand).toBe('npm install && npm run build');
  });

  it('resolves output path for generic by scanning candidate directories (dist, build, out, public)', async () => {
    const pkg = {
      name: 'generic-app',
      scripts: { build: 'tsc' },
    };
    await fs.writeFile(path.join(tempDir, 'package.json'), JSON.stringify(pkg));

    const config = await detectBuildConfig(tempDir);

    // Create 'out' directory
    const outDir = path.join(tempDir, 'out');
    await fs.mkdir(outDir);

    expect(config.resolveOutputPath(tempDir)).toBe(outDir);
  });

  it('falls back to clone root for generic if no candidate directories exist', async () => {
    const pkg = {
      name: 'generic-app',
      scripts: { build: 'tsc' },
    };
    await fs.writeFile(path.join(tempDir, 'package.json'), JSON.stringify(pkg));

    const config = await detectBuildConfig(tempDir);
    expect(config.resolveOutputPath(tempDir)).toBe(tempDir);
  });

  it('treats project as static when package.json has no scripts.build', async () => {
    const pkg = {
      name: 'simple-static',
      dependencies: { jquery: '^3.6.0' },
    };
    await fs.writeFile(path.join(tempDir, 'package.json'), JSON.stringify(pkg));

    const config = await detectBuildConfig(tempDir);
    expect(config.framework).toBe('static');
    expect(config.outputDir).toBe('.');
    expect(config.buildCommand).toContain('No build step needed');
    expect(config.resolveOutputPath(tempDir)).toBe(tempDir);
  });

  it('treats project as static when package.json is missing or corrupted', async () => {
    // Empty directory, no package.json
    const config = await detectBuildConfig(tempDir);
    expect(config.framework).toBe('static');
    expect(config.outputDir).toBe('.');
    expect(config.buildCommand).toContain('No build step needed');
    expect(config.resolveOutputPath(tempDir)).toBe(tempDir);
  });

  it('prefers Vite over generic when both vite dep and build script exist', async () => {
    const pkg = {
      scripts: { build: 'vite build' },
      dependencies: { vite: '^5.0.0' },
    };
    await fs.writeFile(path.join(tempDir, 'package.json'), JSON.stringify(pkg));

    const config = await detectBuildConfig(tempDir);
    expect(config.framework).toBe('vite');
  });
});
