import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import mongoose from 'mongoose';
import { env } from './config/env';
import { httpLogger } from './lib/httpLogger';
import { rejectDollarKeys } from './middleware/rejectDollarKeys';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { apiRouter } from './routes';

/** Builds the Express app without listening, so tests can import it. */
export function createApp() {
  const app = express();
  app.set('trust proxy', 1); // behind Render's proxy: correct req.ip for rate limits, secure cookies
  app.disable('x-powered-by');

  // Order matters: logging/request id → security headers → CORS → body parsing → input checks.
  app.use(httpLogger);
  app.use(helmet());
  app.use(cors({ origin: env.APP_URL, credentials: true }));
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());
  app.use(rejectDollarKeys);

  app.get('/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.get('/ready', async (_req, res) => {
    try {
      const db = mongoose.connection.db;
      if (mongoose.connection.readyState !== 1 || !db) throw new Error('not connected');
      await db.admin().ping();
      res.json({ ok: true });
    } catch {
      res.status(503).json({ ok: false });
    }
  });

  app.use('/api', apiRouter);

  app.use(notFoundHandler); // must be after all routes
  app.use(errorHandler); // must be last
  return app;
}
