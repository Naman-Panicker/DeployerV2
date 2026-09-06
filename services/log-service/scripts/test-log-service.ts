import { createApp } from '../src/app.js';
import { startSubscriber, stopSubscriber } from '../src/services/redis-subscriber.service.js';
import {
  startFlushInterval,
  stopFlushInterval,
  flushAll,
  clearBufferState,
} from '../src/services/log-buffer.service.js';
import { prisma, DeploymentStatus } from '@deployer/prisma';
import { Redis } from 'ioredis';
import { env } from '@deployer/config';
import type { Server } from 'node:http';

const TEST_PORT = 9013;
const BASE_URL = `http://localhost:${TEST_PORT}`;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runLogServiceTests() {
  console.log('========================================================');
  console.log('[Log Service Test Suite] Starting Phase 4 verification...');
  console.log('========================================================');

  // 1. Setup Redis publisher to simulate Build Server
  const publisher = new Redis(env.REDIS_URL);

  // 2. Start subscriber & flush interval (with 1.5s interval for faster test runs)
  await startSubscriber();
  startFlushInterval(1500);

  // 3. Start test HTTP server
  const app = createApp();
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(TEST_PORT, () => resolve(s));
  });

  const createdProjectIds: string[] = [];
  const createdDeploymentIds: string[] = [];

  let passedTests = 0;
  let totalTests = 0;

  function assert(condition: boolean, message: string) {
    totalTests++;
    if (!condition) {
      console.error(`❌ FAILED: ${message}`);
      throw new Error(`Assertion failed: ${message}`);
    }
    passedTests++;
    console.log(`  ✓ ${message}`);
  }

  try {
    // ----------------------------------------------------
    // Test 1: Health Endpoint
    // ----------------------------------------------------
    console.log('\n--- Test 1: Health Endpoint ---');
    const healthRes = await fetch(`${BASE_URL}/health`);
    assert(healthRes.status === 200, 'Health check returns HTTP 200');
    const healthData = await healthRes.json();
    assert(healthData.status === 'ok', 'Health status is "ok"');
    assert(healthData.service === 'log-service', 'Service identifier is "log-service"');

    // ----------------------------------------------------
    // Test 2: 404 for Non-Existent Deployment
    // ----------------------------------------------------
    console.log('\n--- Test 2: 404 for Unknown Deployment ---');
    const fakeId = '00000000-0000-0000-0000-000000000000';
    const notFoundRes = await fetch(`${BASE_URL}/api/logs/${fakeId}`);
    assert(notFoundRes.status === 404, 'Returns 404 for non-existent deployment');

    // Setup a test user, project, and deployment in DB
    const testUser = await prisma.user.upsert({
      where: { email: 'log_tester@example.com' },
      update: {},
      create: {
        email: 'log_tester@example.com',
        passwordHash: 'dummyhash',
      },
    });

    const project1 = await prisma.project.create({
      data: {
        userId: testUser.id,
        name: `test-log-proj-${Date.now()}`,
        repoUrl: 'https://github.com/example/repo',
        subdomain: `test-log-${Date.now()}`,
      },
    });
    createdProjectIds.push(project1.id);

    const deployment1 = await prisma.deployment.create({
      data: {
        projectId: project1.id,
        status: DeploymentStatus.BUILDING,
      },
    });
    createdDeploymentIds.push(deployment1.id);

    // ----------------------------------------------------
    // Test 3: Publish Logs & Periodic Buffer Flush
    // ----------------------------------------------------
    console.log('\n--- Test 3: Publish Logs & Periodic Flush ---');
    const channel1 = `logs:${deployment1.id}`;

    console.log(`  Publishing 10 log lines to channel "${channel1}"...`);
    for (let i = 1; i <= 10; i++) {
      const payload = JSON.stringify({
        stream: i % 2 === 0 ? 'stderr' : 'stdout',
        line: `Build step line ${i}`,
        timestamp: new Date().toISOString(),
      });
      await publisher.publish(channel1, payload);
    }

    // Wait 2.2s for periodic flush to trigger and persist to Postgres
    console.log('  Waiting 2.2s for periodic flush interval...');
    await sleep(2200);

    const logsRes = await fetch(`${BASE_URL}/api/logs/${deployment1.id}`);
    assert(logsRes.status === 200, 'GET /api/logs/:deploymentId returns HTTP 200');
    const logsData = await logsRes.json();
    assert(Array.isArray(logsData.logs), 'Returns an array of logs');
    assert(logsData.logs.length === 10, `Returned exactly 10 logs (got ${logsData.logs.length})`);
    assert(logsData.logs[0].line === 'Build step line 1', 'First line matches');
    assert(logsData.logs[9].line === 'Build step line 10', 'Last line matches');
    assert(logsData.isComplete === false, 'isComplete is false while building');
    assert(Boolean(logsData.nextCursor), 'nextCursor is provided');

    // ----------------------------------------------------
    // Test 4: Cursor-based Pagination
    // ----------------------------------------------------
    console.log('\n--- Test 4: Cursor-based Pagination ---');
    const fifthLogId = logsData.logs[4].id; // 5th item
    const paginatedRes = await fetch(`${BASE_URL}/api/logs/${deployment1.id}?after=${fifthLogId}`);
    assert(paginatedRes.status === 200, 'Paginated request returns HTTP 200');
    const paginatedData = await paginatedRes.json();
    assert(paginatedData.logs.length === 5, `Returns remaining 5 logs after cursor (got ${paginatedData.logs.length})`);
    assert(paginatedData.logs[0].line === 'Build step line 6', 'First paginated log is line 6');
    assert(paginatedData.logs[4].line === 'Build step line 10', 'Last paginated log is line 10');
    assert(
      paginatedData.nextCursor === logsData.logs[9].id,
      'nextCursor matches the latest log id'
    );

    // ----------------------------------------------------
    // Test 5: Count-based Threshold Flush (50 lines)
    // ----------------------------------------------------
    console.log('\n--- Test 5: Immediate Count-Based Threshold Flush ---');
    const deployment2 = await prisma.deployment.create({
      data: {
        projectId: project1.id,
        status: DeploymentStatus.BUILDING,
      },
    });
    createdDeploymentIds.push(deployment2.id);
    const channel2 = `logs:${deployment2.id}`;

    console.log('  Publishing 55 lines rapidly in under 100ms...');
    const publishPromises = [];
    for (let i = 1; i <= 55; i++) {
      const payload = JSON.stringify({
        stream: 'stdout',
        line: `Rapid log line ${i}`,
        timestamp: new Date().toISOString(),
      });
      publishPromises.push(publisher.publish(channel2, payload));
    }
    await Promise.all(publishPromises);

    // Wait just 300ms (much less than 1.5s flush interval) to allow threshold flush to commit
    await sleep(300);

    const thresholdRes = await fetch(`${BASE_URL}/api/logs/${deployment2.id}`);
    const thresholdData = await thresholdRes.json();
    assert(
      thresholdData.logs.length >= 50,
      `Threshold flush triggered immediately (found ${thresholdData.logs.length} >= 50 persisted logs without waiting for interval)`
    );

    // ----------------------------------------------------
    // Test 6: BUILD_COMPLETE Signal Handling
    // ----------------------------------------------------
    console.log('\n--- Test 6: BUILD_COMPLETE Signal Handling ---');
    const completePayload = JSON.stringify({
      stream: 'system',
      line: 'BUILD_COMPLETE',
      timestamp: new Date().toISOString(),
    });
    await publisher.publish(channel2, completePayload);

    // Wait 300ms for pmessage handling and buffer drain
    await sleep(300);

    const completeRes = await fetch(`${BASE_URL}/api/logs/${deployment2.id}`);
    const completeData = await completeRes.json();
    assert(completeData.logs.length === 55, `All 55 logs flushed after BUILD_COMPLETE (got ${completeData.logs.length})`);
    assert(completeData.isComplete === true, 'isComplete is true after BUILD_COMPLETE signal');

    // ----------------------------------------------------
    // Test 7: Historical Log Query on Terminal Status
    // ----------------------------------------------------
    console.log('\n--- Test 7: Historical Query for DEPLOYED Status ---');
    await prisma.deployment.update({
      where: { id: deployment1.id },
      data: { status: DeploymentStatus.DEPLOYED, completedAt: new Date() },
    });

    const historicalRes = await fetch(`${BASE_URL}/api/logs/${deployment1.id}`);
    const historicalData = await historicalRes.json();
    assert(historicalData.logs.length === 10, 'Historical query returns all 10 persisted logs');
    assert(historicalData.isComplete === true, 'isComplete is true for completed deployment');

    console.log('\n========================================================');
    console.log(`🎉 ALL ${passedTests}/${totalTests} TESTS PASSED!`);
    console.log('========================================================\n');
  } finally {
    console.log('[Cleanup] Tearing down test resources...');
    stopFlushInterval();
    await flushAll().catch(() => {});
    clearBufferState();

    await stopSubscriber().catch(() => {});
    await publisher.quit().catch(() => {});

    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });

    // Cleanup DB records
    for (const depId of createdDeploymentIds) {
      await prisma.deploymentLog.deleteMany({ where: { deploymentId: depId } }).catch(() => {});
      await prisma.deployment.delete({ where: { id: depId } }).catch(() => {});
    }
    for (const projId of createdProjectIds) {
      await prisma.project.delete({ where: { id: projId } }).catch(() => {});
    }

    await prisma.$disconnect().catch(() => {});
    console.log('[Cleanup] Completed cleanly.');
  }
}

runLogServiceTests().catch((err) => {
  console.error('\n❌ Test Suite encountered fatal error:', err);
  process.exit(1);
});
