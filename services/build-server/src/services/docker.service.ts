import Docker from 'dockerode';
import { PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { createScrubber } from './scrubber.service.js';
import type { PresignedUploadForms } from './s3.service.js';

export const BUILD_IMAGE = 'deployer-builder:latest';
export const BUILD_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
export const BUILD_MEMORY_LIMIT_MB = 512;
const MANAGED_LABEL = 'deployer.managed';
const STAGE_MARKER = '::deployer-stage::';
const LOG_TAIL_LINES = 50;

const docker = new Docker({ socketPath: '/var/run/docker.sock' });

// Running build containers by deployment ID, so shutdown can kill them
const activeContainers = new Map<string, Docker.Container>();
const abortedDeployments = new Set<string>();

export interface BuildContainerOpts {
  projectId: string;
  deploymentId: string;
  repoUrl: string;
  branch: string;
  envVars: Record<string, string>;
  presignedForms: PresignedUploadForms;
  logServiceUrl: string;
}

export interface BuildResult {
  success: boolean;
  exitCode: number;
  error?: string;
  // Last stage the container reported (setup, clone, detect, install, build, upload)
  stage: string;
  timedOut: boolean;
  oomKilled: boolean;
  // Killed by the Build Server itself (shutdown), not by the build
  aborted: boolean;
  // Docker failed to create, start or wait on the container
  infraError: boolean;
  logTail: string[];
}

/**
 * Splits a byte stream into lines, carrying partial lines across chunks.
 */
function createLineReader(onLine: (line: string) => void) {
  let partial = '';
  return {
    push(chunk: Buffer) {
      const lines = (partial + chunk.toString()).split('\n');
      partial = lines.pop() ?? '';
      for (const line of lines) {
        if (line) onLine(line);
      }
    },
    flush() {
      if (partial) onLine(partial);
      partial = '';
    },
  };
}

/**
 * Kills every running build container (used on shutdown). Their builds are reported as aborted.
 */
export async function abortActiveBuilds(): Promise<void> {
  await Promise.all(
    Array.from(activeContainers.entries()).map(async ([deploymentId, container]) => {
      abortedDeployments.add(deploymentId);
      console.warn(`[Docker] Killing build container for deployment ${deploymentId} (server shutdown)`);
      await container.kill().catch(() => {
        // Container may have already terminated
      });
    })
  );
}

/**
 * Force-removes build containers left behind by a previous Build Server process.
 * Returns the deployment IDs whose containers were removed.
 */
export async function removeOrphanedContainers(): Promise<Set<string>> {
  const removed = new Set<string>();
  const containers = await docker.listContainers({
    all: true,
    filters: { label: [`${MANAGED_LABEL}=true`] },
  });

  for (const info of containers) {
    const deploymentId = info.Labels['deployer.deployment_id'];
    try {
      await docker.getContainer(info.Id).remove({ force: true });
      console.warn(`[Docker] Removed orphaned build container ${info.Id.slice(0, 12)} (deployment ${deploymentId})`);
      if (deploymentId) removed.add(deploymentId);
    } catch (err) {
      console.error(`[Docker] Failed to remove orphaned container ${info.Id.slice(0, 12)}:`, err);
    }
  }

  return removed;
}

/**
 * Verifies if deployer-builder:latest exists locally.
 * If missing, builds it from services/build-server/builder/Dockerfile.
 */
export async function ensureBuildImage(): Promise<void> {
  console.log(`[Docker] Verifying build image '${BUILD_IMAGE}'...`);
  try {
    const image = docker.getImage(BUILD_IMAGE);
    await image.inspect();
    console.log(`[Docker] Build image '${BUILD_IMAGE}' is present locally.`);
    return;
  } catch (err: any) {
    if (err.statusCode !== 404) {
      throw err;
    }
  }

  console.log(`[Docker] Image '${BUILD_IMAGE}' not found. Building builder image...`);
  const builderDir = fileURLToPath(new URL('../../builder', import.meta.url));

  if (!fs.existsSync(builderDir)) {
    throw new Error(`Builder directory not found at ${builderDir}`);
  }

  await new Promise<void>((resolve, reject) => {
    const child = spawn('docker', ['build', '-t', BUILD_IMAGE, builderDir], {
      stdio: 'inherit',
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        console.log(`[Docker] Successfully built image '${BUILD_IMAGE}'.`);
        resolve();
      } else {
        reject(new Error(`docker build exited with code ${code}`));
      }
    });
  });
}

/**
 * Spawns an isolated Docker container with ZERO host filesystem mounts.
 * The container handles cloning, detection, building, and S3 uploading internally.
 */
export async function runBuildInContainer(opts: BuildContainerOpts): Promise<BuildResult> {
  const { projectId, deploymentId, repoUrl, branch, envVars, presignedForms, logServiceUrl } = opts;

  // Initialize secret scrubber for safe console output
  const scrubber = createScrubber(envVars);

  // Build container environment variables
  const containerEnv: Record<string, string> = {
    PROJECT_ID: projectId,
    DEPLOYMENT_ID: deploymentId,
    REPO_URL: repoUrl,
    BRANCH: branch || 'main',
    LOG_SERVICE_URL: logServiceUrl,
    S3_UPLOAD_FORMS: JSON.stringify(presignedForms),
    ...envVars,
  };

  const envArray = Object.entries(containerEnv).map(([key, val]) => `${key}=${val}`);

  // Resolve network mode (join deployer network to reach log-service, or fallback to bridge)
  let networkMode = process.env.DOCKER_NETWORK || 'deployer-network';
  try {
    await docker.getNetwork(networkMode).inspect();
  } catch {
    networkMode = 'bridge';
  }

  let container: Docker.Container | null = null;
  let timeoutId: NodeJS.Timeout | null = null;
  let isTimedOut = false;
  let stage = 'setup';
  const logTail: string[] = [];

  const handleLine = (line: string, isStderr: boolean) => {
    if (line.startsWith(STAGE_MARKER)) {
      stage = line.slice(STAGE_MARKER.length).trim() || stage;
      return;
    }
    const cleanLine = scrubber.scrub(line);
    logTail.push(cleanLine);
    if (logTail.length > LOG_TAIL_LINES) logTail.shift();
    if (isStderr) {
      console.error(`[Container ${deploymentId}] ${cleanLine}`);
    } else {
      console.log(`[Container ${deploymentId}] ${cleanLine}`);
    }
  };
  const stdoutReader = createLineReader((line) => handleLine(line, false));
  const stderrReader = createLineReader((line) => handleLine(line, true));

  const result = (fields: Partial<BuildResult>): BuildResult => ({
    success: false,
    exitCode: 1,
    stage,
    timedOut: isTimedOut,
    oomKilled: false,
    aborted: abortedDeployments.has(deploymentId),
    infraError: false,
    logTail: [...logTail],
    ...fields,
  });

  try {
    // 1. Create completely isolated container with resource limits
    container = await docker.createContainer({
      Image: BUILD_IMAGE,
      Env: envArray,
      HostConfig: {
        // ZERO bind mounts — completely isolated container
        Binds: [],
        Memory: BUILD_MEMORY_LIMIT_MB * 1024 * 1024,     // 512MB RAM limit
        MemorySwap: BUILD_MEMORY_LIMIT_MB * 1024 * 1024, // No swap beyond memory
        CpuPeriod: 100000,
        CpuQuota: 100000,              // 1 CPU core limit
        NetworkMode: networkMode,
      },
      Labels: {
        'deployer.deployment_id': deploymentId,
        [MANAGED_LABEL]: 'true',
      },
    });
    activeContainers.set(deploymentId, container);

    // 2. Attach stdout and stderr for server monitoring
    const rawStream = await container.attach({
      stream: true,
      stdout: true,
      stderr: true,
    });

    const stdoutStream = new PassThrough();
    const stderrStream = new PassThrough();

    docker.modem.demuxStream(rawStream, stdoutStream, stderrStream);

    stdoutStream.on('data', (chunk: Buffer) => stdoutReader.push(chunk));
    stderrStream.on('data', (chunk: Buffer) => stderrReader.push(chunk));

    // 3. Start container
    await container.start();

    // 4. Enforce timeout (5 minutes)
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(async () => {
        isTimedOut = true;
        console.warn(
          `[Docker] Build ${deploymentId} exceeded ${BUILD_TIMEOUT_MS / 1000}s timeout. Force killing container...`
        );
        try {
          await container?.kill();
        } catch {
          // Container may have already terminated
        }
        reject(new Error(`Build timed out after ${BUILD_TIMEOUT_MS / 1000} seconds`));
      }, BUILD_TIMEOUT_MS);
    });

    // 5. Wait for completion
    const waitPromise = container.wait();
    const waitResult = (await Promise.race([waitPromise, timeoutPromise])) as { StatusCode: number };

    if (timeoutId) clearTimeout(timeoutId);

    // Allow pending streams to flush
    await new Promise((resolve) => setTimeout(resolve, 300));
    stdoutReader.flush();
    stderrReader.flush();

    const exitCode = waitResult?.StatusCode ?? 1;

    if (exitCode !== 0) {
      const state = await container.inspect().then((info) => info.State).catch(() => null);
      return result({
        exitCode,
        oomKilled: Boolean(state?.OOMKilled),
        error: `Container process exited with status code ${exitCode}`,
      });
    }

    return result({ success: true, exitCode: 0 });
  } catch (err) {
    if (timeoutId) clearTimeout(timeoutId);
    stdoutReader.flush();
    stderrReader.flush();
    const errorMsg = err instanceof Error ? err.message : String(err);
    return result({
      error: errorMsg,
      infraError: !isTimedOut && !abortedDeployments.has(deploymentId),
    });
  } finally {
    activeContainers.delete(deploymentId);
    abortedDeployments.delete(deploymentId);

    // 6. Cleanup: force remove container
    if (container) {
      try {
        await container.remove({ force: true });
        console.log(`[Docker] Cleaned up container for deployment ${deploymentId}`);
      } catch {
        // Container might already be gone
      }
    }
  }
}
