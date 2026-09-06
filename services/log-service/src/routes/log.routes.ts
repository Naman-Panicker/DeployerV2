import { Router } from 'express';
import { getLogsForDeployment } from '../controllers/log.controller.js';

export const logRouter = Router();

// GET /api/logs/:deploymentId?after=<cursor>
logRouter.get('/:deploymentId', getLogsForDeployment);
