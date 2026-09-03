import { Router } from 'express';
import { requireAuth } from '../middleware/auth.middleware.js';
import { deployLimiter } from '../middleware/rate-limiter.middleware.js';
import {
  createProjectHandler,
  listProjectsHandler,
  getProjectHandler,
  updateProjectHandler,
  deleteProjectHandler,
  setEnvVarsHandler,
  getEnvVarsHandler,
  deployProjectHandler,
  rollbackProjectHandler,
} from '../controllers/project.controller.js';

export const projectRouter = Router();

// All project endpoints require authentication
projectRouter.use(requireAuth);

projectRouter.post('/', createProjectHandler);
projectRouter.get('/', listProjectsHandler);
projectRouter.get('/:id', getProjectHandler);
projectRouter.put('/:id', updateProjectHandler);
projectRouter.delete('/:id', deleteProjectHandler);

// Environment variables
projectRouter.post('/:id/env', setEnvVarsHandler);
projectRouter.get('/:id/env', getEnvVarsHandler);

// Deploy & Rollback triggers (rate limited)
projectRouter.post('/:id/deploy', deployLimiter, deployProjectHandler);
projectRouter.post('/:id/rollback', deployLimiter, rollbackProjectHandler);
