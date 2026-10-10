import { PrismaClient } from '@prisma/client';
import { prisma } from './client.js';

export { prisma, PrismaClient };
export * from '@prisma/client';
export {
  recordDeploymentFailure,
  SYSTEM_FAILURE_MESSAGE,
  type DeploymentFailureInput,
  type RecordedFailure,
} from './failures.js';
