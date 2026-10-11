import { prisma, FailureType, recordDeploymentFailure } from '@deployer/prisma';
import { BUILD_MEMORY_LIMIT_MB, BUILD_TIMEOUT_MS, type BuildResult } from './docker.service.js';

export interface ClassifiedFailure {
  type: FailureType;
  stage: string;
  details: string;
  exitCode?: number;
  userMessage?: string;
}

// Stages where a failure is caused by the repository rather than our infrastructure
const REPO_STAGES = new Set(['clone', 'install', 'build']);

function formatDetails(result: BuildResult): string {
  return [
    `stage=${result.stage} exitCode=${result.exitCode} timedOut=${result.timedOut} oomKilled=${result.oomKilled} aborted=${result.aborted} infraError=${result.infraError}`,
    `error=${result.error || 'none'}`,
    `--- last ${result.logTail.length} container log lines ---`,
    ...result.logTail,
  ].join('\n');
}

/**
 * Decides whether a failed build container was the repository's fault (BUILD_ERROR)
 * or ours (SYSTEM_ERROR), and what the user should be told.
 */
export function classifyContainerFailure(result: BuildResult): ClassifiedFailure {
  const base = { stage: result.stage, exitCode: result.exitCode, details: formatDetails(result) };

  if (result.aborted) {
    return { ...base, type: FailureType.SYSTEM_ERROR, stage: 'shutdown' };
  }

  if (result.infraError) {
    return { ...base, type: FailureType.SYSTEM_ERROR };
  }

  if (result.timedOut) {
    return {
      ...base,
      type: FailureType.BUILD_ERROR,
      userMessage: `The build exceeded the ${BUILD_TIMEOUT_MS / 60_000} minute time limit and was stopped.`,
    };
  }

  if (!REPO_STAGES.has(result.stage)) {
    return { ...base, type: FailureType.SYSTEM_ERROR };
  }

  if (result.oomKilled || result.exitCode === 137) {
    return {
      ...base,
      type: FailureType.BUILD_ERROR,
      userMessage: `The ${result.stage} step was killed (exit code ${result.exitCode}), most likely for exceeding the ${BUILD_MEMORY_LIMIT_MB} MB memory limit.`,
    };
  }

  const userMessages: Record<string, string> = {
    clone: 'Could not clone the repository. Check that the URL and branch are correct and that the repository is public.',
    install: `npm install failed (exit code ${result.exitCode}). See the log above for details.`,
    build: `npm run build failed (exit code ${result.exitCode}). See the log above for details.`,
  };

  return { ...base, type: FailureType.BUILD_ERROR, userMessage: userMessages[result.stage] };
}

/**
 * Wraps an unexpected Build Server exception (S3 presigning, database, etc.) as a SYSTEM_ERROR.
 */
export function classifyServerError(stage: string, err: unknown): ClassifiedFailure {
  return {
    type: FailureType.SYSTEM_ERROR,
    stage,
    details: err instanceof Error ? err.stack || err.message : String(err),
  };
}

export async function notifyLogService(
  logServiceUrl: string,
  deploymentId: string,
  stream: 'stdout' | 'stderr' | 'system',
  line: string
): Promise<boolean> {
  try {
    const res = await fetch(`${logServiceUrl}/api/logs/ingest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deploymentId,
        stream,
        line,
        timestamp: new Date().toISOString(),
      }),
    });
    return res.ok;
  } catch {
    // Ignore logging failures to avoid masking underlying build errors
    return false;
  }
}

/**
 * Records the failure, then makes sure the user sees it in their build log. Goes through the
 * Log Service so it lands after buffered build lines, falling back to a direct database
 * write when the log path (Log Service or Redis) is down.
 */
export async function failDeployment(
  deploymentId: string,
  logServiceUrl: string,
  failure: ClassifiedFailure
): Promise<void> {
  const { userMessage } = await recordDeploymentFailure({ deploymentId, ...failure });
  const line = failure.type === FailureType.BUILD_ERROR ? `❌ Build failed: ${userMessage}` : `⚠️ ${userMessage}`;

  const delivered = await notifyLogService(logServiceUrl, deploymentId, 'stderr', line);
  if (!delivered) {
    await prisma.deploymentLog
      .create({ data: { deploymentId, stream: 'stderr', line } })
      .catch((err) => console.error(`[Maintenance] Could not write failure log line for ${deploymentId}:`, err));
  }

  await notifyLogService(logServiceUrl, deploymentId, 'system', 'BUILD_COMPLETE');
}
