import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prisma, recordDeploymentFailure } from '@deployer/prisma';
import { enqueueBuild } from '../clients/build-queue.client.js';
import { triggerDeploy } from './deployment.service.js';

vi.mock('@deployer/prisma', () => ({
  prisma: {
    project: { findFirst: vi.fn() },
    deployment: { create: vi.fn() },
    deploymentLog: { create: vi.fn() },
  },
  DeploymentStatus: { QUEUED: 'QUEUED', FAILED: 'FAILED' },
  TriggerType: { MANUAL: 'MANUAL' },
  FailureType: { SYSTEM_ERROR: 'SYSTEM_ERROR' },
  recordDeploymentFailure: vi.fn(),
}));

vi.mock('../clients/build-queue.client.js', () => ({
  enqueueBuild: vi.fn(),
}));

describe('deployment.service - triggerDeploy queue acknowledgement', () => {
  const project = { id: 'proj-1', name: 'App', repoUrl: 'https://github.com/a/b', branch: 'main', envVarsEncrypted: null };
  const deployment = { id: 'dep-1', projectId: 'proj-1', status: 'QUEUED', triggerType: 'MANUAL', createdAt: new Date() };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.project.findFirst).mockResolvedValue(project as any);
    vi.mocked(prisma.deployment.create).mockResolvedValue(deployment as any);
    vi.mocked(prisma.deploymentLog.create).mockResolvedValue({} as any);
  });

  it('returns the QUEUED deployment when Redis acknowledges the job', async () => {
    vi.mocked(enqueueBuild).mockResolvedValue(undefined);

    const result = await triggerDeploy('user-1', 'proj-1');

    expect(result.status).toBe('QUEUED');
    expect(enqueueBuild).toHaveBeenCalledWith(
      expect.objectContaining({ deploymentId: 'dep-1', envVarsEncrypted: {} })
    );
    expect(recordDeploymentFailure).not.toHaveBeenCalled();
  });

  it('fails the deployment as SYSTEM_ERROR and logs it for the user when the job is not acknowledged', async () => {
    vi.mocked(enqueueBuild).mockRejectedValue(new Error('Redis did not acknowledge build job within 5000ms'));
    vi.mocked(recordDeploymentFailure).mockResolvedValue({
      failureId: 'ref-1',
      userMessage: 'Something went wrong on our end (reference: ref-1)',
      persisted: true,
    });

    const result = await triggerDeploy('user-1', 'proj-1');

    expect(result.status).toBe('FAILED');
    expect(result.failureType).toBe('SYSTEM_ERROR');
    expect(result.failureMessage).toContain('reference: ref-1');
    expect(recordDeploymentFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        deploymentId: 'dep-1',
        type: 'SYSTEM_ERROR',
        stage: 'queue',
        details: expect.stringContaining('did not acknowledge'),
      })
    );
    expect(prisma.deploymentLog.create).toHaveBeenCalledWith({
      data: { deploymentId: 'dep-1', stream: 'stderr', line: expect.stringContaining('reference: ref-1') },
    });
  });
});
