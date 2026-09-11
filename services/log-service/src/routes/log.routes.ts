import { Router } from 'express';
import { getLogsForDeployment } from '../controllers/log.controller.js';
import { ingestLog } from '../controllers/ingest.controller.js';

export const logRouter = Router();

// POST /api/logs/ingest (internal container log ingestion)
logRouter.post('/ingest', ingestLog);

// GET /api/logs/:deploymentId?after=<cursor>
logRouter.get('/:deploymentId', getLogsForDeployment);

