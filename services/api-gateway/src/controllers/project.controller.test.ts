import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Response, NextFunction } from 'express';
import { getDeploymentLogsHandler } from './project.controller.js';
import type { AuthenticatedRequest } from '../middleware/auth.middleware.js';
import { prisma } from '@deployer/prisma';

vi.mock('@deployer/prisma', () => ({
  prisma: {
    project: {
      findFirst: vi.fn(),
    },
    deployment: {
      findFirst: vi.fn(),
    },
  },
}));

describe('project.controller - getDeploymentLogsHandler query forwarding (S-08)', () => {
  const mockProjectId = 'proj-123';
  const mockDeploymentId = 'deploy-456';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('forwards ?after= cursor query parameter to log-service', async () => {
    vi.mocked(prisma.project.findFirst).mockResolvedValue({ id: mockProjectId } as any);
    vi.mocked(prisma.deployment.findFirst).mockResolvedValue({ id: mockDeploymentId, projectId: mockProjectId } as any);

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({ logs: [], nextCursor: '50' }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const req = {
      params: { id: mockProjectId, deploymentId: mockDeploymentId },
      query: { after: '42' },
      user: { userId: 'user-1' },
    } as unknown as AuthenticatedRequest;

    const jsonMock = vi.fn();
    const statusMock = vi.fn().mockReturnValue({ json: jsonMock });
    const res = { status: statusMock } as unknown as Response;
    const next = vi.fn() as NextFunction;

    await getDeploymentLogsHandler(req, res, next);

    expect(mockFetch).toHaveBeenCalledOnce();
    const requestedUrl = mockFetch.mock.calls[0][0] as string;
    expect(requestedUrl).toContain(`/api/logs/${mockDeploymentId}?after=42`);
    expect(statusMock).toHaveBeenCalledWith(200);
    expect(jsonMock).toHaveBeenCalledWith({ logs: [], nextCursor: '50' });

    vi.unstubAllGlobals();
  });

  it('does not append ?after= when query parameter is omitted', async () => {
    vi.mocked(prisma.project.findFirst).mockResolvedValue({ id: mockProjectId } as any);
    vi.mocked(prisma.deployment.findFirst).mockResolvedValue({ id: mockDeploymentId, projectId: mockProjectId } as any);

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({ logs: [] }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const req = {
      params: { id: mockProjectId, deploymentId: mockDeploymentId },
      query: {},
      user: { userId: 'user-1' },
    } as unknown as AuthenticatedRequest;

    const jsonMock = vi.fn();
    const statusMock = vi.fn().mockReturnValue({ json: jsonMock });
    const res = { status: statusMock } as unknown as Response;
    const next = vi.fn() as NextFunction;

    await getDeploymentLogsHandler(req, res, next);

    expect(mockFetch).toHaveBeenCalledOnce();
    const requestedUrl = mockFetch.mock.calls[0][0] as string;
    expect(requestedUrl).toBe(`http://localhost:9003/api/logs/${mockDeploymentId}`);

    vi.unstubAllGlobals();
  });
});
