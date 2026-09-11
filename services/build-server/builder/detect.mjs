import fs from 'node:fs';
import path from 'node:path';

const appDir = process.argv[2] || '/app';
const packageJsonPath = path.join(appDir, 'package.json');

function detect() {
  if (!fs.existsSync(packageJsonPath)) {
    return {
      hasBuildScript: false,
      buildCommand: '',
      outputDir: '.',
      framework: 'static',
    };
  }

  try {
    const content = fs.readFileSync(packageJsonPath, 'utf-8');
    const pkg = JSON.parse(content);

    const hasBuildScript = Boolean(pkg.scripts?.build);
    const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };

    if (!hasBuildScript) {
      return {
        hasBuildScript: false,
        buildCommand: '',
        outputDir: '.',
        framework: 'static',
      };
    }

    if (deps['vite']) {
      return {
        hasBuildScript: true,
        buildCommand: 'npm run build',
        outputDir: 'dist',
        framework: 'vite',
      };
    }

    if (deps['react-scripts']) {
      return {
        hasBuildScript: true,
        buildCommand: 'npm run build',
        outputDir: 'build',
        framework: 'create-react-app',
      };
    }

    return {
      hasBuildScript: true,
      buildCommand: 'npm run build',
      outputDir: 'dist',
      framework: 'generic',
    };
  } catch (err) {
    return {
      hasBuildScript: false,
      buildCommand: '',
      outputDir: '.',
      framework: 'static',
    };
  }
}

const result = detect();
console.log(JSON.stringify(result));
