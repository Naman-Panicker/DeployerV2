import express from 'express';
import cors from 'cors';
import { generalLimiter } from './middleware/rate-limiter.middleware.js';
import { errorHandler, notFoundHandler } from './middleware/error-handler.middleware.js';
import { authRouter } from './routes/auth.routes.js';
import { projectRouter } from './routes/project.routes.js';
import { webhookRouter } from './routes/webhook.routes.js';

export function createApp() {
  const app = express();

  // Basic security & parsing middleware
  app.use(cors());
  app.use(
    express.json({
      verify: (req: any, _res, buf) => {
        req.rawBody = buf;
      },
    })
  );

  // Global rate limiter
  app.use(generalLimiter);

  // Health check
  app.get('/health', (req, res) => {
    res.status(200).json({
      status: 'ok',
      service: 'api-gateway',
      timestamp: new Date().toISOString(),
    });
  });

  // API Routes
  app.use('/api/auth', authRouter);
  app.use('/api/projects', projectRouter);
  app.use('/api/webhook', webhookRouter);

  // Error handling
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
