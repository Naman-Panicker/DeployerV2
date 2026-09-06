import { createServer } from '../src/server.js';
import { extractSubdomain } from '../src/middleware/subdomain.js';
import { getMimeType, hasFileExtension } from '../src/utils/mime.js';
import { ProjectCache } from '../src/services/project-cache.service.js';
import { prisma, DeploymentStatus } from '@deployer/prisma';
import type { Server } from 'node:http';

const TEST_PORT = 9088;
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runReverseProxyTests() {
  console.log('========================================================');
  console.log('[Reverse Proxy Test Suite] Starting Phase 5 verification...');
  console.log('========================================================');

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

  // =========================================================================
  // Section 1: Subdomain Extraction Unit Tests
  // =========================================================================
  console.log('\n--- Section 1: Subdomain Extraction Tests ---');
  assert(extractSubdomain('my-app.localhost:8080') === 'my-app', 'Extracts subdomain with port');
  assert(extractSubdomain('portfolio-123.localhost') === 'portfolio-123', 'Extracts subdomain without port');
  assert(extractSubdomain('localhost:8080') === null, 'Returns null for bare localhost:8080');
  assert(extractSubdomain('localhost') === null, 'Returns null for bare localhost');
  assert(extractSubdomain('127.0.0.1:8080') === null, 'Returns null for IPv4 address');
  assert(extractSubdomain('::1:8080') === null, 'Returns null for IPv6 address');
  assert(extractSubdomain(undefined) === null, 'Returns null for undefined host');
  assert(extractSubdomain('staging.deployer.internal:8080') === 'staging', 'Extracts leftmost label from internal domains');

  // =========================================================================
  // Section 2: MIME Type & File Extension Tests
  // =========================================================================
  console.log('\n--- Section 2: MIME & File Extension Tests ---');
  assert(hasFileExtension('/index.html') === true, 'index.html has file extension');
  assert(hasFileExtension('/assets/main-bundle.js') === true, 'JS file has file extension');
  assert(hasFileExtension('/styles/app.css') === true, 'CSS file has file extension');
  assert(hasFileExtension('/about') === false, '/about has NO file extension (SPA candidate)');
  assert(hasFileExtension('/dashboard/settings') === false, '/dashboard/settings has NO file extension (SPA candidate)');
  assert(hasFileExtension('/') === false, 'Root path has NO file extension');
  assert(hasFileExtension('/about?foo=bar#hash') === false, 'Query params and hashes do not create file extension');

  assert(getMimeType('index.html').includes('text/html'), 'MIME for index.html is text/html');
  assert(getMimeType('app.js').includes('javascript'), 'MIME for app.js is javascript');
  assert(getMimeType('app.ts').includes('javascript'), 'MIME for app.ts is javascript');
  assert(getMimeType('style.css').includes('text/css'), 'MIME for style.css is text/css');
  assert(getMimeType('data.wasm') === 'application/wasm', 'MIME for data.wasm is application/wasm');

  // =========================================================================
  // Section 3: Project LRU Cache Tests
  // =========================================================================
  console.log('\n--- Section 3: ProjectCache Tests ---');
  const cache = new ProjectCache(2, 50); // capacity 2, TTL 50ms
  cache.set('sub-1', { projectId: 'p1', currentDeploymentId: 'd1' });
  cache.set('sub-2', { projectId: 'p2', currentDeploymentId: 'd2' });

  assert(cache.get('sub-1')?.projectId === 'p1', 'Cache hits entry for sub-1');
  assert(cache.get('sub-2')?.projectId === 'p2', 'Cache hits entry for sub-2');

  // Eviction test: accessing sub-1 makes sub-2 the oldest, adding sub-3 should evict sub-2
  cache.get('sub-1');
  cache.set('sub-3', { projectId: 'p3', currentDeploymentId: 'd3' });
  assert(cache.get('sub-2') === null, 'Oldest entry sub-2 evicted due to LRU limit');
  assert(cache.get('sub-1')?.projectId === 'p1', 'sub-1 retained in cache');
  assert(cache.get('sub-3')?.projectId === 'p3', 'sub-3 retained in cache');

  // Expiration test (TTL 50ms)
  await sleep(60);
  assert(cache.get('sub-1') === null, 'Entry expires after TTL');

  // =========================================================================
  // Section 4: HTTP Server Integration Tests
  // =========================================================================
  console.log('\n--- Section 4: HTTP Server Integration Tests ---');
  const server: Server = await new Promise((resolve) => {
    const s = createServer();
    s.listen(TEST_PORT, () => resolve(s));
  });

  function makeRequest(
    path: string,
    host?: string,
    extraHeaders: Record<string, string> = {}
  ): Promise<{ status: number; text: string; headers: Record<string, string> }> {
    return new Promise((resolve, reject) => {
      import('node:http').then(({ default: http }) => {
        const headers: Record<string, string> = { ...extraHeaders };
        if (host) {
          headers['Host'] = host;
        }
        const req = http.request(
          {
            hostname: '127.0.0.1',
            port: TEST_PORT,
            path,
            headers,
          },
          (res) => {
            let data = '';
            res.on('data', (chunk) => (data += chunk));
            res.on('end', () => {
              const resHeaders: Record<string, string> = {};
              for (const [k, v] of Object.entries(res.headers)) {
                if (v !== undefined) {
                  resHeaders[k.toLowerCase()] = Array.isArray(v) ? v.join(', ') : v;
                }
              }
              resolve({
                status: res.statusCode || 0,
                text: data,
                headers: resHeaders,
              });
            });
          }
        );
        req.on('error', reject);
        req.end();
      });
    });
  }

  const createdProjectIds: string[] = [];
  const createdUserIds: string[] = [];

  try {
    // 1. Health check endpoint
    const healthRes = await makeRequest('/health');
    assert(healthRes.status === 200, 'GET /health returns HTTP 200');
    const healthJson = JSON.parse(healthRes.text);
    assert(healthJson.status === 'ok', 'Health status is "ok"');
    assert(healthJson.service === 'reverse-proxy', 'Service name is "reverse-proxy"');

    // 2. Bare localhost landing page
    const landingRes = await makeRequest('/', `localhost:${TEST_PORT}`);
    assert(landingRes.status === 200, 'Bare localhost returns HTTP 200');
    assert(landingRes.text.includes('Deployer Reverse Proxy'), 'Landing page contains Deployer banner');

    // 3. Security: Path traversal rejected
    const traversalRes = await makeRequest('/../../etc/passwd', `some-project.localhost:${TEST_PORT}`);
    assert(traversalRes.status === 400, 'Raw path traversal /../../ returns HTTP 400');
    assert(traversalRes.text.includes('Path traversal is not permitted'), 'Bad request mentions traversal error');

    const encodedTraversalRes = await makeRequest('/%2e%2e/%2e%2e/etc/passwd', `some-project.localhost:${TEST_PORT}`);
    assert(encodedTraversalRes.status === 400, 'Encoded path traversal /%2e%2e/ returns HTTP 400');

    // 4. Unknown project subdomain returns 404
    const unknownRes = await makeRequest('/', `non-existent-proj-xyz.localhost:${TEST_PORT}`);
    assert(unknownRes.status === 404, 'Non-existent project subdomain returns HTTP 404');
    assert(unknownRes.text.includes('404 Project Not Found'), '404 page indicates Project Not Found');

    // Setup a test user and project in DB for testing
    const testUser = await prisma.user.upsert({
      where: { email: 'proxy_test_user@example.com' },
      update: {},
      create: {
        email: 'proxy_test_user@example.com',
        passwordHash: 'testhash',
      },
    });
    createdUserIds.push(testUser.id);

    const testSubdomain = `test-undeployed-${Date.now()}`;
    const undeployedProject = await prisma.project.create({
      data: {
        userId: testUser.id,
        name: 'Undeployed Test Project',
        repoUrl: 'https://github.com/example/repo',
        subdomain: testSubdomain,
        currentDeploymentId: null,
      },
    });
    createdProjectIds.push(undeployedProject.id);

    // 5. Project exists but has no completed deployment
    const undeployedRes = await makeRequest('/', `${testSubdomain}.localhost:${TEST_PORT}`);
    assert(undeployedRes.status === 404, 'Project without deployment returns HTTP 404');
    assert(undeployedRes.text.includes('404 Not Yet Deployed'), 'Returns friendly "Not Yet Deployed" message');

    // 6. Project exists with a deployment record
    const deployedSubdomain = `test-deployed-${Date.now()}`;
    const deployedProject = await prisma.project.create({
      data: {
        userId: testUser.id,
        name: 'Deployed Test Project',
        repoUrl: 'https://github.com/example/repo',
        subdomain: deployedSubdomain,
      },
    });
    createdProjectIds.push(deployedProject.id);

    const deployment = await prisma.deployment.create({
      data: {
        projectId: deployedProject.id,
        status: DeploymentStatus.DEPLOYED,
      },
    });

    await prisma.project.update({
      where: { id: deployedProject.id },
      data: { currentDeploymentId: deployment.id },
    });

    // Request against deployed project
    const deployedRes = await makeRequest('/index.html', `${deployedSubdomain}.localhost:${TEST_PORT}`);

    // In dev environment with placeholder AWS credentials, 503 is expected for S3 fetch
    // If AWS credentials are configured, it will attempt S3 fetch
    if (deployedRes.status === 503) {
      assert(deployedRes.status === 503, 'Returns HTTP 503 Storage Not Configured when AWS creds are placeholder');
      assert(deployedRes.text.includes('503 Storage Not Configured'), 'Mentions S3 credentials requirement');
    } else {
      console.log(`  ✓ Deployed request returned status ${deployedRes.status}`);
      assert([200, 404].includes(deployedRes.status), 'Returns valid HTTP response from S3 handler');
    }

    // =========================================================================
    // Section 5: S3 Streaming, Headers, ETag & SPA Fallback Tests
    // =========================================================================
    console.log('\n--- Section 5: S3 Streaming, ETag & SPA Fallback Tests ---');
    const { setS3Client } = await import('../src/services/s3-fetcher.service.js');
    const { Readable } = await import('node:stream');

    const mockFiles: Record<string, { body: string; contentType?: string; etag: string }> = {
      [`__outputs/${deployedProject.id}/index.html`]: {
        body: '<html><body><h1>My Single Page App</h1></body></html>',
        contentType: 'text/html; charset=utf-8',
        etag: '"etag-html-123"',
      },
      [`__outputs/${deployedProject.id}/assets/main-bundle.js`]: {
        body: 'console.log("main bundle loaded");',
        contentType: 'application/javascript',
        etag: '"etag-js-456"',
      },
      [`__outputs/${deployedProject.id}/styles/theme.css`]: {
        body: 'body { color: red; }',
        contentType: 'text/css',
        etag: '"etag-css-789"',
      },
    };

    const mockS3Client = {
      send: async (command: any) => {
        const key = command.input?.Key;
        const file = mockFiles[key];
        if (!file) {
          const notFoundError: any = new Error(`NoSuchKey: ${key}`);
          notFoundError.name = 'NoSuchKey';
          notFoundError.$metadata = { httpStatusCode: 404 };
          throw notFoundError;
        }
        return {
          Body: Readable.from([Buffer.from(file.body)]),
          ContentType: file.contentType,
          ContentLength: Buffer.byteLength(file.body),
          ETag: file.etag,
          LastModified: new Date(),
        };
      },
    };

    setS3Client(mockS3Client as any);

    try {
      // 7a. Root URL / -> serves index.html
      const rootRes = await makeRequest('/', `${deployedSubdomain}.localhost:${TEST_PORT}`);
      assert(rootRes.status === 200, 'Root request / returns HTTP 200');
      assert(rootRes.text.includes('<h1>My Single Page App</h1>'), 'Serves index.html content');
      assert(rootRes.headers['content-type']?.includes('text/html'), 'Content-Type is text/html');
      assert(rootRes.headers['cache-control'] === 'public, max-age=0, must-revalidate', 'HTML has must-revalidate cache header');
      assert(rootRes.headers['etag'] === '"etag-html-123"', 'Forwards ETag from S3');

      // 7b. Conditional request with ETag -> 304 Not Modified
      const notModifiedRes = await makeRequest('/', `${deployedSubdomain}.localhost:${TEST_PORT}`, {
        'If-None-Match': '"etag-html-123"',
      });
      assert(notModifiedRes.status === 304, 'If-None-Match returns HTTP 304 Not Modified');

      // 7c. Static hashed asset -> immutable cache header
      const assetRes = await makeRequest('/assets/main-bundle.js', `${deployedSubdomain}.localhost:${TEST_PORT}`);
      assert(assetRes.status === 200, 'Asset request returns HTTP 200');
      assert(assetRes.text.includes('main bundle loaded'), 'Serves JS file content');
      assert(assetRes.headers['content-type']?.includes('javascript'), 'Content-Type is application/javascript');
      assert(assetRes.headers['cache-control'] === 'public, max-age=31536000, immutable', 'Assets have immutable cache header');

      // 7d. SPA fallback: extensionless route -> serves index.html with fallback header
      const spaRes = await makeRequest('/dashboard/settings', `${deployedSubdomain}.localhost:${TEST_PORT}`);
      assert(spaRes.status === 200, 'Extensionless route /dashboard/settings returns HTTP 200 (SPA fallback)');
      assert(spaRes.text.includes('<h1>My Single Page App</h1>'), 'SPA route falls back to index.html');
      assert(spaRes.headers['x-served-by']?.includes('spa-fallback'), 'X-Served-By indicates spa-fallback');

      // 7e. Missing static asset with extension -> returns 404 (does NOT fall back to index.html)
      const missingAssetRes = await makeRequest('/assets/missing-logo.png', `${deployedSubdomain}.localhost:${TEST_PORT}`);
      assert(missingAssetRes.status === 404, 'Missing asset with extension returns HTTP 404 (no SPA fallback)');
      assert(missingAssetRes.text.includes('404 File Not Found'), 'Returns File Not Found error');
    } finally {
      setS3Client(null);
    }
  } finally {
    // Clean up DB records
    console.log('\n--- Cleanup Database Test Records ---');
    for (const pid of createdProjectIds) {
      await prisma.deployment.deleteMany({ where: { projectId: pid } });
      await prisma.project.delete({ where: { id: pid } }).catch(() => {});
    }
    for (const uid of createdUserIds) {
      await prisma.user.delete({ where: { id: uid } }).catch(() => {});
    }
    console.log('  ✓ Test database records cleaned up.');

    // Close HTTP server
    await new Promise<void>((resolve) => server.close(() => resolve()));
    console.log('  ✓ Test HTTP server closed.');
  }

  console.log('\n========================================================');
  console.log(`[Reverse Proxy Test Suite] All ${totalTests} checks PASSED (${passedTests}/${totalTests})!`);
  console.log('========================================================\n');
}

runReverseProxyTests().catch((err) => {
  console.error('[Reverse Proxy Test Suite] Error:', err);
  process.exit(1);
});
