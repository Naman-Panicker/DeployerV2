import type { Response, NextFunction } from 'express';
import type { AuthenticatedRequest } from '../middleware/auth.middleware.js';
import {
  createProjectSchema,
  updateProjectSchema,
  envVarsSchema,
  rollbackSchema,
} from '../utils/validation.js';
import {
  createProject,
  listUserProjects,
  getProjectById,
  updateProject,
  deleteProject,
  setProjectEnvVars,
  getProjectEnvVars,
} from '../services/project.service.js';
import { triggerDeploy, triggerRollback } from '../services/deployment.service.js';
import { prisma, DeploymentStatus } from '@deployer/prisma';
import { env } from '@deployer/config';


function getParamId(param: string | string[] | undefined): string {
  if (Array.isArray(param)) {
    return param[0] || '';
  }
  return param || '';
}

export async function createProjectHandler(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = req.user!.userId;
    const body = createProjectSchema.parse(req.body);

    const project = await createProject(userId, body);
    res.status(201).json({ message: 'Project created successfully', project });
  } catch (err) {
    next(err);
  }
}

export async function listProjectsHandler(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = req.user!.userId;
    const projects = await listUserProjects(userId);
    res.status(200).json({ projects });
  } catch (err) {
    next(err);
  }
}

export async function getProjectHandler(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = req.user!.userId;
    const id = getParamId(req.params.id);

    const project = await getProjectById(userId, id);
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    res.status(200).json({ project });
  } catch (err) {
    next(err);
  }
}

export async function updateProjectHandler(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = req.user!.userId;
    const id = getParamId(req.params.id);
    const body = updateProjectSchema.parse(req.body);

    const updated = await updateProject(userId, id, body);
    if (!updated) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    res.status(200).json({ message: 'Project updated successfully', project: updated });
  } catch (err) {
    next(err);
  }
}

export async function deleteProjectHandler(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = req.user!.userId;
    const id = getParamId(req.params.id);

    const deleted = await deleteProject(userId, id);
    if (!deleted) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    res.status(200).json({ message: 'Project deleted successfully' });
  } catch (err) {
    next(err);
  }
}

export async function setEnvVarsHandler(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = req.user!.userId;
    const id = getParamId(req.params.id);
    const envVars = envVarsSchema.parse(req.body);

    const result = await setProjectEnvVars(userId, id, envVars);
    if (!result) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    res.status(200).json({
      message: 'Environment variables stored securely (AES-256 encrypted)',
      count: result.count,
    });
  } catch (err) {
    next(err);
  }
}

export async function getEnvVarsHandler(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = req.user!.userId;
    const id = getParamId(req.params.id);

    const envVars = await getProjectEnvVars(userId, id);
    if (!envVars) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    res.status(200).json({ envVars });
  } catch (err) {
    next(err);
  }
}

export async function deployProjectHandler(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = req.user!.userId;
    const id = getParamId(req.params.id);

    const deployment = await triggerDeploy(userId, id);

    // Build job was never acknowledged by the queue
    if (deployment.status === DeploymentStatus.FAILED) {
      res.status(503).json({
        error: deployment.failureMessage,
        deployment: {
          id: deployment.id,
          projectId: deployment.projectId,
          status: deployment.status,
          failureType: deployment.failureType,
          failureMessage: deployment.failureMessage,
        },
      });
      return;
    }

    res.status(202).json({
      message: 'Deployment triggered successfully',
      deployment: {
        id: deployment.id,
        projectId: deployment.projectId,
        status: deployment.status,
        triggerType: deployment.triggerType,
        createdAt: deployment.createdAt,
      },
    });
  } catch (err) {
    next(err);
  }
}

export async function rollbackProjectHandler(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = req.user!.userId;
    const id = getParamId(req.params.id);
    const { deploymentId } = rollbackSchema.parse(req.body);

    const rollbackDeployment = await triggerRollback(userId, id, deploymentId);

    res.status(202).json({
      message: 'Rollback triggered successfully',
      deployment: {
        id: rollbackDeployment.id,
        projectId: rollbackDeployment.projectId,
        status: rollbackDeployment.status,
        triggerType: rollbackDeployment.triggerType,
        createdAt: rollbackDeployment.createdAt,
      },
    });
  } catch (err) {
    next(err);
  }
}

export async function listDeploymentsHandler(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = req.user!.userId;
    const projectId = getParamId(req.params.id);

    const project = await prisma.project.findFirst({
      where: { id: projectId, userId },
    });

    if (!project) {
      res.status(404).json({ error: 'Project not found or unauthorized' });
      return;
    }

    const deployments = await prisma.deployment.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        projectId: true,
        status: true,
        commitHash: true,
        triggerType: true,
        failureType: true,
        failureMessage: true,
        startedAt: true,
        completedAt: true,
        createdAt: true,
      },
    });

    res.status(200).json({ deployments });
  } catch (err) {
    next(err);
  }
}

export async function getDeploymentLogsHandler(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = req.user!.userId;
    const projectId = getParamId(req.params.id);
    const deploymentId = getParamId(req.params.deploymentId);

    // 1. Verify project belongs to user
    const project = await prisma.project.findFirst({
      where: { id: projectId, userId },
    });

    if (!project) {
      res.status(404).json({ error: 'Project not found or unauthorized' });
      return;
    }

    // 2. Verify deployment exists and belongs to this project
    const deployment = await prisma.deployment.findFirst({
      where: { id: deploymentId, projectId },
    });

    if (!deployment) {
      res.status(404).json({ error: 'Deployment not found for this project' });
      return;
    }

    // 3. Proxy request to Log Service (forward query parameters like ?after=)
    const logUrl = new URL(`${env.LOG_SERVICE_URL}/api/logs/${deploymentId}`);
    for (const [key, value] of Object.entries(req.query)) {
      if (typeof value === 'string' && value.trim().length > 0) {
        logUrl.searchParams.set(key, value.trim());
      }
    }
    const logServiceUrl = logUrl.toString();
    try {
      const logRes = await fetch(logServiceUrl);
      if (!logRes.ok) {
        res.status(logRes.status).json({ error: `Log service returned status ${logRes.status}` });
        return;
      }
      const data = await logRes.json();
      res.status(200).json(data);
    } catch (fetchErr) {
      console.error(`[API Gateway] Failed to contact Log Service at ${logServiceUrl}:`, fetchErr);
      res.status(502).json({ error: 'Log Service unavailable' });
    }
  } catch (err) {
    next(err);
  }
}

