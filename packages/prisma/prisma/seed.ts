import { PrismaClient, DeploymentStatus, TriggerType } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting database seed...');

  const passwordAdmin = await bcrypt.hash('admin123', 10);
  const passwordDemo = await bcrypt.hash('demo123', 10);

  // 1. Seed Users (Upsert by email)
  const adminUser = await prisma.user.upsert({
    where: { email: 'admin@deployer.dev' },
    update: { passwordHash: passwordAdmin },
    create: {
      email: 'admin@deployer.dev',
      passwordHash: passwordAdmin,
    },
  });

  const demoUser = await prisma.user.upsert({
    where: { email: 'demo@deployer.dev' },
    update: { passwordHash: passwordDemo },
    create: {
      email: 'demo@deployer.dev',
      passwordHash: passwordDemo,
    },
  });

  console.log(`👤 Users seeded: ${adminUser.email}, ${demoUser.email}`);

  // Clean existing seed projects if any (to enable clean idempotent re-seeding)
  await prisma.project.deleteMany({
    where: {
      userId: adminUser.id,
      subdomain: { in: ['vite-react-app', 'cra-dashboard', 'docs-site'] },
    },
  });

  // 2. Seed Projects
  const viteProject = await prisma.project.create({
    data: {
      name: 'Vite React App',
      repoUrl: 'https://github.com/vitejs/vite',
      branch: 'main',
      subdomain: 'vite-react-app',
      userId: adminUser.id,
      envVarsEncrypted: {
        VITE_API_URL: 'https://api.deployer.dev',
        VITE_ENABLE_ANALYTICS: 'true',
      },
    },
  });

  const craProject = await prisma.project.create({
    data: {
      name: 'CRA Dashboard',
      repoUrl: 'https://github.com/facebook/create-react-app',
      branch: 'main',
      subdomain: 'cra-dashboard',
      userId: adminUser.id,
      envVarsEncrypted: {
        REACT_APP_STAGE: 'staging',
      },
    },
  });

  const docsProject = await prisma.project.create({
    data: {
      name: 'Documentation Site',
      repoUrl: 'https://github.com/deployer/docs',
      branch: 'master',
      subdomain: 'docs-site',
      userId: adminUser.id,
    },
  });

  console.log('📁 Projects created: vite-react-app, cra-dashboard, docs-site');

  // 3. Seed Deployments
  // Vite Project: 1 Deployed + 1 Building
  const dep1 = await prisma.deployment.create({
    data: {
      projectId: viteProject.id,
      status: DeploymentStatus.DEPLOYED,
      triggerType: TriggerType.MANUAL,
      commitHash: 'a1b2c3d4e5f6',
      s3Prefix: `__outputs/${viteProject.id}/`,
      startedAt: new Date(Date.now() - 3600_000), // 1 hour ago
      completedAt: new Date(Date.now() - 3480_000), // 58 mins ago (duration: 2 mins)
    },
  });

  // Update currentDeploymentId on the project
  await prisma.project.update({
    where: { id: viteProject.id },
    data: { currentDeploymentId: dep1.id },
  });

  const dep2 = await prisma.deployment.create({
    data: {
      projectId: viteProject.id,
      status: DeploymentStatus.BUILDING,
      triggerType: TriggerType.WEBHOOK,
      commitHash: 'b2c3d4e5f6a7',
      startedAt: new Date(Date.now() - 60_000),
    },
  });

  // CRA Project: 1 Deployed + 1 Failed
  const dep3 = await prisma.deployment.create({
    data: {
      projectId: craProject.id,
      status: DeploymentStatus.DEPLOYED,
      triggerType: TriggerType.MANUAL,
      commitHash: 'c3d4e5f6a7b8',
      s3Prefix: `__outputs/${craProject.id}/`,
      startedAt: new Date(Date.now() - 7200_000),
      completedAt: new Date(Date.now() - 7050_000),
    },
  });

  await prisma.project.update({
    where: { id: craProject.id },
    data: { currentDeploymentId: dep3.id },
  });

  const dep4 = await prisma.deployment.create({
    data: {
      projectId: craProject.id,
      status: DeploymentStatus.FAILED,
      triggerType: TriggerType.MANUAL,
      commitHash: 'd4e5f6a7b8c9',
      startedAt: new Date(Date.now() - 1800_000),
      completedAt: new Date(Date.now() - 1770_000),
    },
  });

  // Docs Project: 1 Queued
  const dep5 = await prisma.deployment.create({
    data: {
      projectId: docsProject.id,
      status: DeploymentStatus.QUEUED,
      triggerType: TriggerType.MANUAL,
      commitHash: 'e5f6a7b8c9d0',
    },
  });

  console.log('🚀 Deployments created across projects (DEPLOYED, BUILDING, FAILED, QUEUED)');

  // 4. Seed DeploymentLogs
  const viteSuccessLogs = [
    { stream: 'stdout', line: 'Initiating clone: https://github.com/vitejs/vite (branch: main)...', offset: 0 },
    { stream: 'stdout', line: 'Repository cloned successfully in 1.2s', offset: 2 },
    { stream: 'stdout', line: 'Detecting build configuration...', offset: 3 },
    { stream: 'stdout', line: '[Detect] Detected Vite framework. Output dir: dist', offset: 4 },
    { stream: 'stdout', line: 'Running build command: npm install && npm run build', offset: 5 },
    { stream: 'stdout', line: 'vite v5.4.0 building for production...', offset: 15 },
    { stream: 'stdout', line: '✓ 34 modules transformed.', offset: 25 },
    { stream: 'stdout', line: 'dist/index.html                   0.45 kB', offset: 28 },
    { stream: 'stdout', line: 'dist/assets/index-D7hQ8L9P.css    1.20 kB', offset: 29 },
    { stream: 'stdout', line: 'dist/assets/index-B5kR2M1N.js   143.50 kB', offset: 30 },
    { stream: 'stdout', line: '✓ Built in 450ms.', offset: 31 },
    { stream: 'stdout', line: `Uploading artifacts to S3 prefix: __outputs/${viteProject.id}/`, offset: 35 },
    { stream: 'stdout', line: 'Uploaded 3 files to S3 successfully.', offset: 40 },
    { stream: 'stdout', line: 'Routing updated. Deployment live at http://vite-react-app.localhost:8080', offset: 42 },
  ];

  await prisma.deploymentLog.createMany({
    data: viteSuccessLogs.map((log) => ({
      deploymentId: dep1.id,
      stream: log.stream,
      line: log.line,
      timestamp: new Date(dep1.startedAt!.getTime() + log.offset * 1000),
    })),
  });

  const craFailedLogs = [
    { stream: 'stdout', line: 'Initiating clone: https://github.com/facebook/create-react-app (branch: main)...', offset: 0 },
    { stream: 'stdout', line: 'Repository cloned successfully.', offset: 2 },
    { stream: 'stdout', line: '[Detect] Detected Create React App framework.', offset: 3 },
    { stream: 'stdout', line: 'Running build command: npm install && npm run build', offset: 4 },
    { stream: 'stderr', line: 'npm ERR! code ELIFECYCLE', offset: 15 },
    { stream: 'stderr', line: 'npm ERR! errno 1', offset: 16 },
    { stream: 'stderr', line: 'npm ERR! Failed at the build script: react-scripts build', offset: 17 },
    { stream: 'stderr', line: 'Build process exited with code 1', offset: 18 },
  ];

  await prisma.deploymentLog.createMany({
    data: craFailedLogs.map((log) => ({
      deploymentId: dep4.id,
      stream: log.stream,
      line: log.line,
      timestamp: new Date(dep4.startedAt!.getTime() + log.offset * 1000),
    })),
  });

  console.log('📝 Deployment logs seeded for completed and failed deployments.');
  console.log('✅ Database seed completed successfully!');
}

main()
  .catch((e) => {
    console.error('❌ Error during seeding:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
