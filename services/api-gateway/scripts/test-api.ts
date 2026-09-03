import { createApp } from '../src/app.js';
import type { Server } from 'node:http';

const PORT = 9010; // Use alternate port for testing
const BASE_URL = `http://localhost:${PORT}`;

async function runApiTests() {
  console.log('[API Test Suite] Starting API Gateway test suite...');

  const app = createApp();
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(PORT, () => resolve(s));
  });

  try {
    // 0. Health check
    console.log('\n--- Test 0: Health Check ---');
    const healthRes = await fetch(`${BASE_URL}/health`);
    const healthJson = await healthRes.json();
    console.log('Health status:', healthRes.status, healthJson);
    if (healthRes.status !== 200) throw new Error('Health check failed');

    // 1. Signup
    console.log('\n--- Test 1: User Signup ---');
    const testEmail = `tester_${Date.now()}@example.com`;
    const testPassword = 'Password123!';

    const signupRes = await fetch(`${BASE_URL}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: testEmail, password: testPassword }),
    });
    const signupJson = await signupRes.json();
    console.log('Signup status:', signupRes.status, signupJson.message);
    if (signupRes.status !== 201 || !signupJson.token) {
      throw new Error(`Signup failed: ${JSON.stringify(signupJson)}`);
    }

    // 2. Login
    console.log('\n--- Test 2: User Login ---');
    const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: testEmail, password: testPassword }),
    });
    const loginJson = await loginRes.json();
    console.log('Login status:', loginRes.status, loginJson.message);
    if (loginRes.status !== 200 || !loginJson.token) {
      throw new Error(`Login failed: ${JSON.stringify(loginJson)}`);
    }
    const token = loginJson.token;

    // 3. Authenticated profile
    console.log('\n--- Test 3: Auth Profile (GET /api/auth/me) ---');
    const meRes = await fetch(`${BASE_URL}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const meJson = await meRes.json();
    console.log('Profile status:', meRes.status, meJson.user?.email);
    if (meRes.status !== 200 || meJson.user?.email !== testEmail) {
      throw new Error('Profile fetch failed');
    }

    // 4. Create Project
    console.log('\n--- Test 4: Create Project ---');
    const createProjectRes = await fetch(`${BASE_URL}/api/projects`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        name: 'My Cool Website',
        repoUrl: 'https://github.com/octocat/Hello-World.git',
        branch: 'master',
      }),
    });
    const createProjectJson = await createProjectRes.json();
    console.log('Create Project status:', createProjectRes.status, createProjectJson.project?.subdomain);
    if (createProjectRes.status !== 201 || !createProjectJson.project?.id) {
      throw new Error(`Create project failed: ${JSON.stringify(createProjectJson)}`);
    }
    const project = createProjectJson.project;

    // 5. List Projects
    console.log('\n--- Test 5: List Projects ---');
    const listRes = await fetch(`${BASE_URL}/api/projects`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const listJson = await listRes.json();
    console.log('List Projects count:', listJson.projects?.length);
    if (listRes.status !== 200 || listJson.projects?.length === 0) {
      throw new Error('List projects failed');
    }

    // 6. Get Single Project
    console.log('\n--- Test 6: Get Project Details ---');
    const getRes = await fetch(`${BASE_URL}/api/projects/${project.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const getJson = await getRes.json();
    console.log('Get Project status:', getRes.status, getJson.project?.name);
    if (getRes.status !== 200 || getJson.project?.id !== project.id) {
      throw new Error('Get project failed');
    }

    // 7. Store Encrypted Environment Variables
    console.log('\n--- Test 7: Set Encrypted Env Vars ---');
    const envPayload = {
      API_KEY: 'super-secret-key-123',
      NODE_ENV: 'production',
      PORT: '3000',
    };
    const setEnvRes = await fetch(`${BASE_URL}/api/projects/${project.id}/env`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(envPayload),
    });
    const setEnvJson = await setEnvRes.json();
    console.log('Set Env Vars status:', setEnvRes.status, setEnvJson.message);
    if (setEnvRes.status !== 200) throw new Error('Set env vars failed');

    // 8. Retrieve and Decrypt Environment Variables
    console.log('\n--- Test 8: Get Decrypted Env Vars ---');
    const getEnvRes = await fetch(`${BASE_URL}/api/projects/${project.id}/env`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const getEnvJson = await getEnvRes.json();
    console.log('Get Env Vars keys:', Object.keys(getEnvJson.envVars || {}));
    if (
      getEnvJson.envVars?.API_KEY !== 'super-secret-key-123' ||
      getEnvJson.envVars?.NODE_ENV !== 'production'
    ) {
      throw new Error('Decrypted env vars do not match original plaintext values');
    }

    // 9. Trigger Manual Deployment
    console.log('\n--- Test 9: Trigger Deployment ---');
    const deployRes = await fetch(`${BASE_URL}/api/projects/${project.id}/deploy`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    const deployJson = await deployRes.json();
    console.log('Deploy status:', deployRes.status, deployJson.deployment?.status);
    if (deployRes.status !== 202 || deployJson.deployment?.status !== 'QUEUED') {
      throw new Error(`Deploy trigger failed: ${JSON.stringify(deployJson)}`);
    }

    // 10. Webhook Trigger
    console.log('\n--- Test 10: GitHub Webhook Push Ingestion ---');
    const webhookRes = await fetch(`${BASE_URL}/api/webhook/github`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ref: 'refs/heads/master',
        repository: {
          clone_url: 'https://github.com/octocat/Hello-World.git',
          default_branch: 'master',
        },
        head_commit: {
          id: 'abcdef1234567890',
          message: 'Update index.html',
        },
      }),
    });
    const webhookJson = await webhookRes.json();
    console.log('Webhook status:', webhookRes.status, webhookJson.message);
    if (webhookRes.status !== 202 || webhookJson.deployment?.triggerType !== 'WEBHOOK') {
      throw new Error(`Webhook deployment failed: ${JSON.stringify(webhookJson)}`);
    }

    // 11. Rollback validation (testing error when deployment is not DEPLOYED)
    console.log('\n--- Test 11: Rollback Validation ---');
    const rollbackRes = await fetch(`${BASE_URL}/api/projects/${project.id}/rollback`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        deploymentId: deployJson.deployment.id,
      }),
    });
    const rollbackJson = await rollbackRes.json();
    console.log('Rollback validation response (expected rejection):', rollbackRes.status, rollbackJson.error);
    if (rollbackRes.status !== 400) {
      throw new Error('Rollback should fail for non-DEPLOYED status');
    }

    console.log('\n✅ ALL API GATEWAY TESTS PASSED SUCCESSFULLY!\n');
  } finally {
    server.close();
  }
}

runApiTests().catch((err) => {
  console.error('\n❌ API Test Suite Failed:', err);
  process.exit(1);
});
