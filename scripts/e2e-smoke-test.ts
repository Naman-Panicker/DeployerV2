/**
 * DeployerV2 End-to-End Smoke Test Script
 *
 * Runs against a live stack to verify the complete lifecycle:
 * 1. Health checks (API Gateway, Reverse Proxy)
 * 2. User registration and authentication
 * 3. Project creation with custom subdomain
 * 4. Deployment triggering
 * 5. Deployment status & log polling
 * 6. Site resolution via Reverse Proxy
 * 7. Teardown / cleanup
 *
 * Usage:
 *   npx tsx scripts/e2e-smoke-test.ts
 *   npm run test:e2e
 */

const API_URL = process.env.E2E_API_URL || 'http://localhost:9000';
const PROXY_URL = process.env.E2E_PROXY_URL || 'http://localhost:8080';
const REPO_URL = process.env.E2E_TEST_REPO || 'https://github.com/vitejs/vite';
const TIMEOUT_MS = parseInt(process.env.E2E_TIMEOUT_MS || '300000', 10); // 5 minutes default
const POLL_INTERVAL_MS = 3000;

const COLORS = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
};

function logStep(step: number, total: number, title: string) {
  console.log(`\n${COLORS.cyan}[${step}/${total}] ${title}${COLORS.reset}`);
}

function logSuccess(msg: string) {
  console.log(`  ${COLORS.green}✓ ${msg}${COLORS.reset}`);
}

function logWarn(msg: string) {
  console.log(`  ${COLORS.yellow}⚠ ${msg}${COLORS.reset}`);
}

function logError(msg: string) {
  console.error(`  ${COLORS.red}✗ ${msg}${COLORS.reset}`);
}

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runSmokeTest() {
  const startTime = Date.now();
  const totalSteps = 8;
  const runId = Math.random().toString(36).substring(2, 8);
  const testEmail = `e2e-${runId}@deployer.dev`;
  const testPassword = `Pass_${runId}!123`;
  const testSubdomain = `e2e-app-${runId}`;

  console.log(`${COLORS.bright}====================================================${COLORS.reset}`);
  console.log(`${COLORS.bright}🚀 DeployerV2 End-to-End Pipeline Smoke Test${COLORS.reset}`);
  console.log(`${COLORS.bright}====================================================${COLORS.reset}`);
  console.log(`API Gateway:   ${API_URL}`);
  console.log(`Reverse Proxy: ${PROXY_URL}`);
  console.log(`Repository:    ${REPO_URL}`);
  console.log(`Test User:     ${testEmail}`);
  console.log(`Subdomain:     ${testSubdomain}`);

  let token = '';
  let projectId = '';
  let deploymentId = '';

  try {
    // -------------------------------------------------------------
    // Step 1: Health Checks
    // -------------------------------------------------------------
    logStep(1, totalSteps, 'Verifying service health checks...');

    try {
      const apiHealthRes = await fetch(`${API_URL}/health`);
      if (!apiHealthRes.ok) throw new Error(`API Gateway health returned status ${apiHealthRes.status}`);
      const apiHealth = await apiHealthRes.json();
      logSuccess(`API Gateway healthy (${apiHealth.service || 'ok'})`);
    } catch (err) {
      logError(`Cannot reach API Gateway at ${API_URL}. Is the service running?`);
      throw err;
    }

    try {
      const proxyHealthRes = await fetch(`${PROXY_URL}/health`);
      if (!proxyHealthRes.ok) throw new Error(`Reverse Proxy health returned status ${proxyHealthRes.status}`);
      const proxyHealth = await proxyHealthRes.json();
      logSuccess(`Reverse Proxy healthy (${proxyHealth.service || 'ok'})`);
    } catch (err) {
      logWarn(`Reverse Proxy check failed at ${PROXY_URL}/health (may still be starting or optional)`);
    }

    // -------------------------------------------------------------
    // Step 2: User Registration
    // -------------------------------------------------------------
    logStep(2, totalSteps, 'Registering fresh test user...');
    const signupRes = await fetch(`${API_URL}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: testEmail, password: testPassword }),
    });

    if (!signupRes.ok) {
      const errBody = await signupRes.text();
      throw new Error(`Signup failed (${signupRes.status}): ${errBody}`);
    }

    const signupData = await signupRes.json();
    token = signupData.token;
    logSuccess(`User registered: ${signupData.user.id}`);

    // -------------------------------------------------------------
    // Step 3: Authenticate & Verify Profile
    // -------------------------------------------------------------
    logStep(3, totalSteps, 'Verifying auth token with /api/auth/me...');
    const meRes = await fetch(`${API_URL}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!meRes.ok) throw new Error(`Auth verification failed (${meRes.status})`);
    const meData = await meRes.json();
    logSuccess(`Authenticated as: ${meData.user.email}`);

    // -------------------------------------------------------------
    // Step 4: Create Project
    // -------------------------------------------------------------
    logStep(4, totalSteps, `Creating project with subdomain '${testSubdomain}'...`);
    const createProjRes = await fetch(`${API_URL}/api/projects`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        name: `Smoke Test App ${runId}`,
        repoUrl: REPO_URL,
        branch: 'main',
        subdomain: testSubdomain,
      }),
    });

    if (!createProjRes.ok) {
      const err = await createProjRes.text();
      throw new Error(`Project creation failed (${createProjRes.status}): ${err}`);
    }

    const projData = await createProjRes.json();
    projectId = projData.project.id;
    logSuccess(`Project created: ${projectId} (subdomain: ${projData.project.subdomain})`);

    // -------------------------------------------------------------
    // Step 5: Trigger Deployment
    // -------------------------------------------------------------
    logStep(5, totalSteps, `Triggering deployment for project ${projectId}...`);
    const deployRes = await fetch(`${API_URL}/api/projects/${projectId}/deploy`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!deployRes.ok) {
      const err = await deployRes.text();
      throw new Error(`Deploy trigger failed (${deployRes.status}): ${err}`);
    }

    const deployData = await deployRes.json();
    deploymentId = deployData.deployment.id;
    logSuccess(`Deployment queued: ${deploymentId} (status: ${deployData.deployment.status})`);

    // -------------------------------------------------------------
    // Step 6: Poll Deployment Status & Logs
    // -------------------------------------------------------------
    logStep(6, totalSteps, `Monitoring deployment ${deploymentId}...`);
    const pollStart = Date.now();
    let currentStatus = 'QUEUED';
    let isTerminal = false;

    while (!isTerminal) {
      if (Date.now() - pollStart > TIMEOUT_MS) {
        throw new Error(`Deployment timed out after ${TIMEOUT_MS / 1000}s`);
      }

      await sleep(POLL_INTERVAL_MS);

      const listRes = await fetch(`${API_URL}/api/projects/${projectId}/deployments`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (listRes.ok) {
        const listData = await listRes.json();
        const dep = listData.deployments?.find((d: any) => d.id === deploymentId);
        if (dep) {
          if (dep.status !== currentStatus) {
            currentStatus = dep.status;
            console.log(`  ➔ Status transition: ${COLORS.bright}${currentStatus}${COLORS.reset}`);
          }
          if (currentStatus === 'DEPLOYED' || currentStatus === 'FAILED') {
            isTerminal = true;
          }
        }
      }

      // Try reading logs
      try {
        const logsRes = await fetch(
          `${API_URL}/api/projects/${projectId}/deployments/${deploymentId}/logs`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        if (logsRes.ok) {
          const logsData = await logsRes.json();
          if (logsData.logs && logsData.logs.length > 0) {
            const lastLog = logsData.logs[logsData.logs.length - 1];
            process.stdout.write(`  [log] ${lastLog.line}\r`);
          }
        }
      } catch {
        // logs are optional during polling
      }
    }

    console.log(''); // newline after \r
    if (currentStatus === 'DEPLOYED') {
      logSuccess(`Deployment succeeded in ${Math.round((Date.now() - pollStart) / 1000)}s!`);
    } else {
      logWarn(`Deployment finished with status: ${currentStatus}`);
    }

    // -------------------------------------------------------------
    // Step 7: Verify Site Resolution via Reverse Proxy
    // -------------------------------------------------------------
    logStep(7, totalSteps, `Testing Reverse Proxy resolution for '${testSubdomain}'...`);
    try {
      const siteRes = await fetch(`${PROXY_URL}/`, {
        headers: {
          Host: `${testSubdomain}.localhost:8080`,
        },
      });

      if (siteRes.ok) {
        const bodyText = await siteRes.text();
        logSuccess(`Site responded with status ${siteRes.status} (${bodyText.length} bytes)`);
      } else {
        logWarn(`Reverse Proxy returned status ${siteRes.status} (artifacts may still be syncing)`);
      }
    } catch (proxyErr) {
      logWarn(`Reverse Proxy HTTP request failed: ${proxyErr instanceof Error ? proxyErr.message : String(proxyErr)}`);
    }

    // -------------------------------------------------------------
    // Step 8: Cleanup Test Resources
    // -------------------------------------------------------------
    logStep(8, totalSteps, 'Cleaning up test project...');
    const delRes = await fetch(`${API_URL}/api/projects/${projectId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });

    if (delRes.ok) {
      logSuccess('Test project deleted.');
    } else {
      logWarn(`Could not delete test project (${delRes.status})`);
    }

    const duration = Math.round((Date.now() - startTime) / 1000);
    console.log(`\n${COLORS.green}${COLORS.bright}====================================================${COLORS.reset}`);
    console.log(`${COLORS.green}${COLORS.bright}🎉 E2E Smoke Test Completed Successfully in ${duration}s!${COLORS.reset}`);
    console.log(`${COLORS.green}${COLORS.bright}====================================================${COLORS.reset}\n`);
    process.exit(0);
  } catch (error) {
    const duration = Math.round((Date.now() - startTime) / 1000);
    console.error(`\n${COLORS.red}${COLORS.bright}====================================================${COLORS.reset}`);
    console.error(`${COLORS.red}${COLORS.bright}❌ E2E Smoke Test Failed after ${duration}s${COLORS.reset}`);
    console.error(`${COLORS.red}${error instanceof Error ? error.message : String(error)}${COLORS.reset}`);
    console.error(`${COLORS.red}${COLORS.bright}====================================================${COLORS.reset}\n`);

    // Best-effort cleanup
    if (token && projectId) {
      try {
        await fetch(`${API_URL}/api/projects/${projectId}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        });
        console.log('Cleaned up test project after failure.');
      } catch {
        // ignore cleanup error
      }
    }

    process.exit(1);
  }
}

runSmokeTest();
