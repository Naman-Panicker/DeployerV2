import { Request, Response } from 'express';
import { prisma, DeploymentStatus } from '@deployer/prisma';
import { isMarkedComplete, getBufferSize } from '../services/log-buffer.service.js';

/**
 * SECURITY NOTE (Deferred to Phase 6):
 * This endpoint is currently unauthenticated as part of internal microservice isolation.
 * In Phase 6 (End-to-End Integration), access to deployment logs MUST be guarded through
 * the API Gateway with JWT authentication and project ownership verification.
 */

export async function getLogsForDeployment(req: Request, res: Response): Promise<void> {
  const { deploymentId } = req.params;

  if (!deploymentId || typeof deploymentId !== 'string') {
    res.status(400).json({ error: 'deploymentId parameter is required' });
    return;
  }

  try {
    const deployment = await prisma.deployment.findUnique({
      where: { id: deploymentId },
      select: { id: true, status: true },
    });

    if (!deployment) {
      res.status(404).json({ error: `Deployment "${deploymentId}" not found` });
      return;
    }

    let afterId: bigint | undefined;
    if (typeof req.query.after === 'string' && req.query.after.trim().length > 0) {
      try {
        afterId = BigInt(req.query.after);
      } catch {
        res.status(400).json({ error: 'Invalid cursor "after". Must be a valid numeric ID.' });
        return;
      }
    }

    const logs = await prisma.deploymentLog.findMany({
      where: {
        deploymentId,
        ...(afterId !== undefined ? { id: { gt: afterId } } : {}),
      },
      orderBy: { id: 'asc' },
      take: 200,
    });

    const isTerminalStatus =
      deployment.status === DeploymentStatus.DEPLOYED ||
      deployment.status === DeploymentStatus.FAILED;

    const hasBufferedLogs = getBufferSize(deploymentId) > 0;
    const isComplete = (isTerminalStatus || isMarkedComplete(deploymentId)) && !hasBufferedLogs;

    const nextCursor =
      logs.length > 0
        ? logs[logs.length - 1].id.toString()
        : afterId !== undefined
        ? afterId.toString()
        : null;

    const serializedLogs = logs.map((log) => ({
      id: log.id.toString(),
      deploymentId: log.deploymentId,
      stream: log.stream,
      line: log.line,
      timestamp: log.timestamp.toISOString(),
    }));

    res.status(200).json({
      logs: serializedLogs,
      nextCursor,
      isComplete,
    });
  } catch (err) {
    console.error(`[Log Controller] Error fetching logs for deployment ${deploymentId}:`, err);
    res.status(500).json({ error: 'Failed to fetch deployment logs' });
  }
}
