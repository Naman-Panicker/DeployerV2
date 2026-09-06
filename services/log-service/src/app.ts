import express from 'express';
import cors from 'cors';
import { logRouter } from './routes/log.routes.js';

export function createApp() {
  const app = express();

  app.use(cors());
  app.use(express.json());

  // Health check
  app.get('/health', (_req, res) => {
    res.status(200).json({
      status: 'ok',
      service: 'log-service',
      timestamp: new Date().toISOString(),
    });
  });

  // Log routes
  app.use('/api/logs', logRouter);

  // 404 handler
  app.use((_req, res) => {
    res.status(404).json({ error: 'Not Found' });
  });

  return app;
}
