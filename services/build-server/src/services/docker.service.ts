import Docker from 'dockerode';
import { PassThrough } from 'node:stream';
import { publishLog } from './redis.service.js';
import { createScrubber } from './scrubber.service.js';

export const BUILD_IMAGE = 'node:20-alpine';
const BUILD_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

const docker = new Docker({ socketPath: '/var/run/docker.sock' });

export interface BuildContainerOpts {
  deploymentId: string;
  clonePath: string;
  buildCommand: string;
  envVars: Record<string, string>;
}

export interface BuildResult {
  success: boolean;
  exitCode: number;
  error?: string;
}

/**
 * Checks if the build image is cached locally. If missing, pulls it from Docker Hub.
 * Called during Build Server startup to eliminate first-build latency.
 */
export async function ensureBuildImage(): Promise<void> {
  console.log(`[Docker] Verifying build image '${BUILD_IMAGE}'...`);
  try {
    const image = docker.getImage(BUILD_IMAGE);
    await image.inspect();
    console.log(`[Docker] Build image '${BUILD_IMAGE}' is present locally.`);
  } catch (err: any) {
    if (err.statusCode === 404) {
      console.log(`[Docker] Image '${BUILD_IMAGE}' not found locally. Pulling...`);
      const stream = await docker.pull(BUILD_IMAGE);
      await new Promise<void>((resolve, reject) => {
        docker.modem.followProgress(
          stream,
          (pullErr, output) => {
            if (pullErr) reject(pullErr);
            else resolve();
          },
          (event) => {
            if (event.status) {
              // Log pull progress without flooding console
              if (event.progressDetail?.total) {
                // detailed progress
              }
            }
          }
        );
      });
      console.log(`[Docker] Successfully pulled image '${BUILD_IMAGE}'.`);
    } else {
      throw err;
    }
  }
}

/**
 * Spawns an isolated Docker container, mounts the cloned repository,
 * injects environment variables, executes the build command,
 * streams logs to Redis (with secret redaction), and enforces resource limits.
 */
export async function runBuildInContainer(opts: BuildContainerOpts): Promise<BuildResult> {
  const { deploymentId, clonePath, buildCommand, envVars } = opts;

  // Initialize secret scrubber to prevent leaking secrets to logs
  const scrubber = createScrubber(envVars);

  // Format env vars for Docker: ['KEY=value', ...]
  const envArray = Object.entries(envVars).map(([key, val]) => `${key}=${val}`);

  let container: Docker.Container | null = null;
  let timeoutId: NodeJS.Timeout | null = null;
  let isTimedOut = false;

  try {
    // 1. Create container with safety constraints
    container = await docker.createContainer({
      Image: BUILD_IMAGE,
      Cmd: ['sh', '-c', buildCommand],
      WorkingDir: '/app',
      Env: envArray,
      HostConfig: {
        Binds: [`${clonePath}:/app`],
        Memory: 512 * 1024 * 1024,     // 512MB RAM
        MemorySwap: 512 * 1024 * 1024, // No swap beyond memory
        CpuPeriod: 100000,
        CpuQuota: 100000,              // 1 CPU core
        NetworkMode: 'bridge',
      },
      Labels: {
        'deployer.deployment_id': deploymentId,
        'deployer.managed': 'true',
      },
    });

    // 2. Attach to stdout/stderr streams before starting
    const rawStream = await container.attach({
      stream: true,
      stdout: true,
      stderr: true,
    });

    const stdoutStream = new PassThrough();
    const stderrStream = new PassThrough();

    docker.modem.demuxStream(rawStream, stdoutStream, stderrStream);

    stdoutStream.on('data', (chunk: Buffer) => {
      const lines = chunk.toString().split('\n').filter(Boolean);
      for (const line of lines) {
        const cleanLine = scrubber.scrub(line);
        publishLog(deploymentId, 'stdout', cleanLine);
      }
    });

    stderrStream.on('data', (chunk: Buffer) => {
      const lines = chunk.toString().split('\n').filter(Boolean);
      for (const line of lines) {
        const cleanLine = scrubber.scrub(line);
        publishLog(deploymentId, 'stderr', cleanLine);
      }
    });

    // 3. Start container
    await container.start();

    // 4. Enforce timeout
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(async () => {
        isTimedOut = true;
        console.warn(`[Docker] Build ${deploymentId} exceeded ${BUILD_TIMEOUT_MS / 1000}s timeout. Force killing container...`);
        await publishLog(
          deploymentId,
          'stderr',
          `❌ Build timed out after ${BUILD_TIMEOUT_MS / 1000} seconds. Force killed.`
        );
        try {
          await container?.kill();
        } catch {
          // Container may have already terminated
        }
        reject(new Error('Build timed out'));
      }, BUILD_TIMEOUT_MS);
    });

    // 5. Wait for exit
    const waitPromise = container.wait();
    const result = (await Promise.race([waitPromise, timeoutPromise])) as { StatusCode: number };

    if (timeoutId) clearTimeout(timeoutId);

    // Allow lingering stream chunks to flush
    await new Promise((resolve) => setTimeout(resolve, 300));

    const exitCode = result?.StatusCode ?? 1;

    if (exitCode !== 0) {
      return {
        success: false,
        exitCode,
        error: `Container process exited with status code ${exitCode}`,
      };
    }

    return { success: true, exitCode: 0 };
  } catch (err) {
    if (timeoutId) clearTimeout(timeoutId);
    const errorMsg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      exitCode: 1,
      error: errorMsg,
    };
  } finally {
    // 6. Cleanup: remove container
    if (container) {
      try {
        await container.remove({ force: true });
      } catch {
        // Container might already be gone
      }
    }
  }
}
