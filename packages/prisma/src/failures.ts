import crypto from 'node:crypto';
import { DeploymentStatus, FailureType } from '@prisma/client';
import { prisma } from './client.js';

/**
 * Shown to users for SYSTEM_ERROR failures. Internal details stay in deployment_failures.
 */
export const SYSTEM_FAILURE_MESSAGE =
  'Something went wrong on our end while deploying. This was not caused by your code. Please try again shortly.';

export interface DeploymentFailureInput {
  deploymentId: string;
  type: FailureType;
  stage: string;
  details: string;
  exitCode?: number;
  // Required for BUILD_ERROR; SYSTEM_ERROR always uses SYSTEM_FAILURE_MESSAGE
  userMessage?: string;
}

export interface RecordedFailure {
  failureId: string;
  userMessage: string;
  persisted: boolean;
}

/**
 * Marks a deployment FAILED, flags it with a failure type and user-facing message,
 * and stores an internal maintenance record. Never throws: if the database itself is
 * unavailable, the full record is written to the server log instead.
 */
export async function recordDeploymentFailure(input: DeploymentFailureInput): Promise<RecordedFailure> {
  const failureId = crypto.randomUUID();
  const userMessage =
    input.type === FailureType.SYSTEM_ERROR
      ? `${SYSTEM_FAILURE_MESSAGE} (reference: ${failureId})`
      : input.userMessage || 'The build failed. See the log above for details.';

  console.error(
    `[Maintenance] DEPLOYMENT_FAILED type=${input.type} deployment=${input.deploymentId} stage=${input.stage} exitCode=${input.exitCode ?? 'n/a'} ref=${failureId}`
  );

  try {
    await prisma.$transaction([
      prisma.deploymentFailure.create({
        data: {
          id: failureId,
          deploymentId: input.deploymentId,
          type: input.type,
          stage: input.stage,
          exitCode: input.exitCode ?? null,
          details: input.details,
        },
      }),
      prisma.deployment.update({
        where: { id: input.deploymentId },
        data: {
          status: DeploymentStatus.FAILED,
          failureType: input.type,
          failureMessage: userMessage,
          completedAt: new Date(),
        },
      }),
    ]);
    return { failureId, userMessage, persisted: true };
  } catch (err) {
    console.error(
      `[Maintenance] Could not persist failure record ${failureId} for deployment ${input.deploymentId}. Details:\n${input.details}\nPersist error:`,
      err
    );
    return { failureId, userMessage, persisted: false };
  }
}
