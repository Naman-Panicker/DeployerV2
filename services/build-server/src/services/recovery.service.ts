import { prisma, DeploymentStatus, FailureType } from '@deployer/prisma';
import { removeOrphanedContainers } from './docker.service.js';
import { failDeployment } from './failure.service.js';

/**
 * Cleans up after a Build Server crash. Runs once on startup, before workers start:
 * 1. Force-removes any build containers left running by the previous process.
 * 2. Fails every deployment still marked BUILDING as a SYSTEM_ERROR.
 *
 * Assumes a single Build Server per machine: at startup, nothing else can be building.
 */
export async function recoverInterruptedBuilds(): Promise<void> {
  let removedContainers = new Set<string>();
  try {
    removedContainers = await removeOrphanedContainers();
  } catch (err) {
    console.error('[Recovery] Could not list orphaned build containers (is Docker reachable?):', err);
  }

  const interrupted = await prisma.deployment.findMany({
    where: { status: DeploymentStatus.BUILDING },
    select: { id: true },
  });

  if (interrupted.length === 0 && removedContainers.size === 0) {
    console.log('[Recovery] No interrupted builds found.');
    return;
  }

  console.warn(
    `[Recovery] Found ${interrupted.length} interrupted build(s); removed ${removedContainers.size} orphaned container(s).`
  );

  for (const { id } of interrupted) {
    await failDeployment(id, {
      type: FailureType.SYSTEM_ERROR,
      stage: 'recovery',
      details: removedContainers.has(id)
        ? 'Build Server restarted while this deployment was BUILDING. Its orphaned container was removed.'
        : 'Build Server restarted while this deployment was BUILDING. No container was left running.',
    });
  }
}
