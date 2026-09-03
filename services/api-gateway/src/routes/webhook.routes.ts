import { Router } from 'express';
import { githubWebhookHandler } from '../controllers/webhook.controller.js';

export const webhookRouter = Router();

webhookRouter.post('/github', githubWebhookHandler);
