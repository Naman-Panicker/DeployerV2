import { Redis } from 'ioredis';
import { credentials } from '@grpc/grpc-js';
import { BuildServiceClient } from '@deployer/proto';
import { env } from '@deployer/config';
import { prisma, DeploymentStatus } from '@deployer/prisma';
import { createScrubber } from '../src/services/scrubber.service.js';
import { detectBuildConfig } from '../src/services/detect.service.js';
import { ensureBuildImage } from '../src/services/docker.service.js';
import { publishLog, publishBuildComplete } from '../src/services/redis.service.js';
import { startServer as startUploadServer } from '../../upload-service/src/server.js';
import { startServer as startBuildServer } from '../src/server.js';
import { setUploadClient } from '../src/clients/upload.client.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const TEST_BUILD_PORT = 9011;
const TEST_UPLOAD_PORT = 9012;

async function runTests() {
  console.log('====================================================');
  console.log('🚀 Phase 3: Build Server Test Suite');
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

  const rawLog = "Error: Failed to connect using postgres://admin:supersecretpw@prod-db.internal:5432/main with key sk_live_998877665544332211 on port 80";
  const scrubbedLog = scrubber.scrub(rawLog);

  assert(!scrubbedLog.includes('supersecretpw'), 'Database password was scrubbed');
  assert(!scrubbedLog.includes('sk_live_998877665544332211'), 'Secret key was scrubbed');
  assert(scrubbedLog.includes('[REDACTED]'), 'Replaced secrets with [REDACTED]');
  assert(scrubbedLog.includes('80'), 'Preserved short non-sensitive string "80"');

  // Test console.log(process.env) simulation
  const dumpedEnv = `process.env = { "VITE_SECRET_KEY": "${secrets.VITE_SECRET_KEY}" }`;
  const scrubbedDump = scrubber.scrub(dumpedEnv);
  assert(scrubbedDump === 'process.env = { "VITE_SECRET_KEY": "[REDACTED]" }', 'Full process.env dump redacted correctly');

  // ─────────────────────────────────────────────────────────────────────────
  // TEST 2: Framework & Build Auto-Detection
  // ─────────────────────────────────────────────────────────────────────────
  console.log('\n--- Test 2: Framework & Build Detection ---');
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'deployer-detect-test-'));

  // 2a. Vite project
  await fs.writeFile(
    path.join(tempDir, 'package.json'),
    JSON.stringify({
      scripts: { build: 'vite build' },
      devDependencies: { vite: '^5.0.0' },
    })
  );
  const viteConfig = await detectBuildConfig(tempDir);
  assert(viteConfig.framework === 'vite', 'Detected Vite project');
  assert(viteConfig.outputDir === 'dist', 'Vite output dir is dist');
  assert(viteConfig.buildCommand.includes('npm run build'), 'Vite build command has npm run build');

  // 2b. Static site (no build script)
  await fs.writeFile(
    path.join(tempDir, 'package.json'),
    JSON.stringify({
      name: 'static-site',
      version: '1.0.0',
    })
  );
  const staticConfig = await detectBuildConfig(tempDir);
  assert(staticConfig.framework === 'static', 'Detected static project without build script');
  assert(staticConfig.outputDir === '.', 'Static output dir is root');

  await fs.rm(tempDir, { recursive: true, force: true });

  // ─────────────────────────────────────────────────────────────────────────
  // TEST 3: Docker Image Auto-Pull
  // ─────────────────────────────────────────────────────────────────────────
  console.log('\n--- Test 3: Docker Image Auto-Pull (node:20-alpine) ---');
  try {
    await ensureBuildImage();
    assert(true, 'Docker node:20-alpine image verified / pulled successfully');
  } catch (dockerErr: any) {
    assert(false, `Docker ensureBuildImage failed: ${dockerErr.message}`);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // TEST 4: Redis Pub/Sub Log Streaming
  // ─────────────────────────────────────────────────────────────────────────
  console.log('\n--- Test 4: Redis Pub/Sub Log Streaming ---');
  const subscriber = new Redis(env.REDIS_URL);
  const testChannel = 'logs:test-stream-deploy-1';
  const receivedMessages: string[] = [];

  await subscriber.subscribe(testChannel);
  subscriber.on('message', (_channel, msg) => {
    receivedMessages.push(msg);
  });

  await new Promise((resolve) => setTimeout(resolve, 200));

  await publishLog('test-stream-deploy-1', 'stdout', 'Hello from test build log');
  await publishBuildComplete('test-stream-deploy-1');

  // Allow message delivery
  await new Promise((resolve) => setTimeout(resolve, 500));

  assert(receivedMessages.length >= 2, `Received ${receivedMessages.length} messages on Redis channel`);
  const parsedFirst = JSON.parse(receivedMessages[0]);
  assert(parsedFirst.line === 'Hello from test build log', 'First log message content matched');
  const parsedSecond = JSON.parse(receivedMessages[1]);
  assert(parsedSecond.line === 'BUILD_COMPLETE', 'Received BUILD_COMPLETE system signal');

  await subscriber.unsubscribe();
  await subscriber.quit();

  // ─────────────────────────────────────────────────────────────────────────
  // TEST 5: Full gRPC Service & Build Pipeline
  // ─────────────────────────────────────────────────────────────────────────
  console.log('\n--- Test 5: End-to-End Build Server gRPC Pipeline ---');

  // Override ports for testing
  process.env.UPLOAD_SERVICE_PORT = String(TEST_UPLOAD_PORT);
  process.env.BUILD_SERVER_PORT = String(TEST_BUILD_PORT);

  // Start Upload Service & Build Server on test ports
  setUploadClient(null);
  const uploadServer = await startUploadServer(TEST_UPLOAD_PORT);
  const buildServer = await startBuildServer(TEST_BUILD_PORT);

  const client = new BuildServiceClient(
    `localhost:${TEST_BUILD_PORT}`,
    credentials.createInsecure()
  );

  // Setup test user & project in DB
  const testUser = await prisma.user.upsert({
    where: { email: 'buildtest@deployer.local' },
    update: {},
    create: {
      email: 'buildtest@deployer.local',
      passwordHash: 'testhash',
    },
  });

  const testProject = await prisma.project.create({
    data: {
      userId: testUser.id,
      name: 'Test Hello World App',
      subdomain: `test-hw-${Date.now()}`,
      repoUrl: 'https://github.com/octocat/Hello-World.git',
      branch: 'master',
    },
  });

  const testDeployment = await prisma.deployment.create({
    data: {
      projectId: testProject.id,
      status: DeploymentStatus.QUEUED,
      triggerType: 'MANUAL',
    },
  });

  console.log(`Created test deployment: ${testDeployment.id} for project: ${testProject.id}`);

  // Subscribe to Redis logs for this deployment
  const deployLogs: string[] = [];
  const deploySubscriber = new Redis(env.REDIS_URL);
  await deploySubscriber.subscribe(`logs:${testDeployment.id}`);
  deploySubscriber.on('message', (_channel, msg) => {
    const data = JSON.parse(msg);
    deployLogs.push(data.line);
    console.log(`   [Redis Stream] [${data.stream}] ${data.line}`);
  });

  // Trigger build via gRPC
  const triggerRes = await new Promise<{ accepted: boolean; message: string }>((resolve, reject) => {
    client.triggerBuild(
      {
        projectId: testProject.id,
        deploymentId: testDeployment.id,
        repoUrl: testProject.repoUrl,
        branch: 'master',
        envVars: {
          TEST_SECRET: 'secret_value_12345',
        },
      },
      (err, res) => {
        if (err) return reject(err);
        resolve(res);
      }
    );
  });

  assert(triggerRes.accepted === true, 'TriggerBuild RPC returned accepted: true');

  // Wait for build pipeline to complete (polling DB status with timeout)
  console.log('Waiting for build pipeline execution (CLONING -> BUILDING -> UPLOADING -> DEPLOYED)...');
  const startTime = Date.now();
  let finalStatus: string = 'QUEUED';

  while (Date.now() - startTime < 60000) {
    const dep = await prisma.deployment.findUnique({
      where: { id: testDeployment.id },
    });
    if (dep?.status === DeploymentStatus.DEPLOYED || dep?.status === DeploymentStatus.FAILED) {
      finalStatus = dep.status;
      break;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }

  assert(
    finalStatus === DeploymentStatus.DEPLOYED,
    `Deployment finished with status: ${finalStatus}`
  );

  // Test GetBuildStatus RPC
  const statusRes = await new Promise<{ deploymentId: string; status: string }>((resolve, reject) => {
    client.getBuildStatus({ deploymentId: testDeployment.id }, (err, res) => {
      if (err) return reject(err);
      resolve(res);
    });
  });

  assert(statusRes.status === DeploymentStatus.DEPLOYED, `GetBuildStatus RPC returned ${statusRes.status}`);

  // Verify project currentDeploymentId updated
  const updatedProject = await prisma.project.findUnique({
    where: { id: testProject.id },
  });
  assert(
    updatedProject?.currentDeploymentId === testDeployment.id,
    'Project currentDeploymentId was updated to this deployment'
  );

  // Cleanup servers and DB test records
  await deploySubscriber.unsubscribe();
  await deploySubscriber.quit();

  await new Promise<void>((resolve) => uploadServer.tryShutdown(() => resolve()));
  await new Promise<void>((resolve) => buildServer.tryShutdown(() => resolve()));

  await prisma.deployment.deleteMany({ where: { projectId: testProject.id } });
  await prisma.project.delete({ where: { id: testProject.id } });
  await prisma.user.delete({ where: { id: testUser.id } });

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
