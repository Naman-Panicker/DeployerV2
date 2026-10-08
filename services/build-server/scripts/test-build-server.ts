import { createScrubber } from '../src/services/scrubber.service.js';
import { generatePresignedForms, copyArtifactsInS3 } from '../src/services/s3.service.js';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

async function runTests() {
  console.log('====================================================');
  console.log('🚀 Build Server Test Suite (Pure Orchestrator)');
  console.log('====================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, msg: string) {
    if (condition) {
      console.log(`  ✅ PASS: ${msg}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL: ${msg}`);
      failed++;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // TEST 1: Secret Log Scrubber
  // ─────────────────────────────────────────────────────────────────────────
  console.log('--- Test 1: Log Scrubber (Secret Redaction) ---');
  const secrets = {
    VITE_SECRET_KEY: 'sk_live_998877665544332211',
    DATABASE_URL: 'postgres://admin:supersecretpw@prod-db.internal:5432/main',
    PORT: '80', // short (< 4 chars), should not be redacted
  };

  const scrubber = createScrubber(secrets);

  const rawLog =
    'Error: Failed to connect using postgres://admin:supersecretpw@prod-db.internal:5432/main with key sk_live_998877665544332211 on port 80';
  const scrubbedLog = scrubber.scrub(rawLog);

  assert(!scrubbedLog.includes('supersecretpw'), 'Database password was scrubbed');
  assert(!scrubbedLog.includes('sk_live_998877665544332211'), 'Secret key was scrubbed');
  assert(scrubbedLog.includes('[REDACTED]'), 'Replaced secrets with [REDACTED]');
  assert(scrubbedLog.includes('80'), 'Preserved short non-sensitive string "80"');

  const dumpedEnv = `process.env = { "VITE_SECRET_KEY": "${secrets.VITE_SECRET_KEY}" }`;
  const scrubbedDump = scrubber.scrub(dumpedEnv);
  assert(
    scrubbedDump === 'process.env = { "VITE_SECRET_KEY": "[REDACTED]" }',
    'Full process.env dump redacted correctly'
  );

  // ─────────────────────────────────────────────────────────────────────────
  // TEST 2: Builder Container Framework Detection Script
  // ─────────────────────────────────────────────────────────────────────────
  console.log('\n--- Test 2: Container Framework & Build Detection (detect.mjs) ---');
  const detectScriptPath = fileURLToPath(new URL('../builder/detect.mjs', import.meta.url));
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'deployer-detect-test-'));

  // 2a. Vite project
  await fs.writeFile(
    path.join(tempDir, 'package.json'),
    JSON.stringify({
      scripts: { build: 'vite build' },
      devDependencies: { vite: '^5.0.0' },
    })
  );
  const viteOut = execFileSync('node', [detectScriptPath, tempDir], { encoding: 'utf-8' });
  const viteConfig = JSON.parse(viteOut.trim());
  assert(viteConfig.framework === 'vite', 'Detected Vite project');
  assert(viteConfig.outputDir === 'dist', 'Vite output dir is dist');
  assert(viteConfig.hasBuildScript === true, 'Vite hasBuildScript is true');

  // 2b. Static site (no build script)
  await fs.writeFile(
    path.join(tempDir, 'package.json'),
    JSON.stringify({
      name: 'static-site',
      version: '1.0.0',
    })
  );
  const staticOut = execFileSync('node', [detectScriptPath, tempDir], { encoding: 'utf-8' });
  const staticConfig = JSON.parse(staticOut.trim());
  assert(staticConfig.framework === 'static', 'Detected static project without build script');
  assert(staticConfig.outputDir === '.', 'Static output dir is root');
  assert(staticConfig.hasBuildScript === false, 'Static hasBuildScript is false');

  await fs.rm(tempDir, { recursive: true, force: true });

  // ─────────────────────────────────────────────────────────────────────────
  // TEST 3: S3 Presigned Forms & Copy Operations
  // ─────────────────────────────────────────────────────────────────────────
  console.log('\n--- Test 3: S3 Presigned POST Forms & Artifact Copy ---');
  const forms = await generatePresignedForms('proj-123', 'deploy-456');
  assert(typeof forms.bucket === 'string', 'Generated forms has bucket name');
  assert(forms.outputs.prefix === '__outputs/proj-123/', 'Outputs prefix formatted correctly');
  assert(
    forms.history.prefix === '__history/proj-123/deploy-456/',
    'History prefix formatted correctly'
  );
  assert(typeof forms.outputs.url === 'string', 'Outputs URL generated');
  assert(typeof forms.history.url === 'string', 'History URL generated');

  const copyResult = await copyArtifactsInS3(
    '__history/proj-123/deploy-456/',
    '__outputs/proj-123/'
  );
  assert(
    copyResult.success === true || (copyResult.errorMessage && copyResult.errorMessage.includes('No artifacts found')),
    `copyArtifactsInS3 executed successfully (result: ${copyResult.success ? 'copied' : copyResult.errorMessage})`
  );

  console.log('\n====================================================');
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log('====================================================');

  if (failed > 0) {
    process.exit(1);
  }
  process.exit(0);
}

runTests().catch((err) => {
  console.error('Test suite unhandled error:', err);
  process.exit(1);
});
