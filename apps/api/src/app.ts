import path from 'node:path';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import mongoose from 'mongoose';
import { env } from './config/env';
import { httpLogger } from './lib/httpLogger';
import { rejectDollarKeys } from './middleware/rejectDollarKeys';
import { apiLimiter } from './middleware/rateLimits';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { apiRouter } from './routes';
import { startNotifier } from './notifications/fromEvents';

export interface AppOptions {
  /**
   * Folder with the built React app (apps/web/dist). When set, Express also serves the
   * web app, so the browser, the API and (Day 14) the sockets share ONE origin:
   * first-party cookies, no CORS. server.ts sets it in production only.
   */
  webDist?: string;
}

/** Builds the Express app without listening, so tests can import it. */
export function createApp(options: AppOptions = {}) {
  startNotifier(); // domain events → notifications (idempotent: once per process)
  const app = express();
  app.set('trust proxy', 1); // behind Render's proxy: correct req.ip for rate limits, secure cookies
  app.disable('x-powered-by');

  // Order matters: logging/request id → security headers → CORS → body parsing → input checks.
  app.use(httpLogger);
  app.use(
    helmet({
      contentSecurityPolicy: {
        // Spelled out (not helmet's defaults) so the policy is reviewable in one place.
        useDefaults: false,
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"], // no inline scripts, no CDNs: the build is self-contained
          styleSrc: ["'self'", "'unsafe-inline'"], // Radix, sonner and recharts set inline styles
          imgSrc: ["'self'", 'data:'],
          fontSrc: ["'self'", 'data:'], // Geist is bundled
          // Our own origin plus its wss:// form for Socket.io. Older Safari versions don't
          // treat wss: as 'self', which would silently block the live board.
          connectSrc: ["'self'", env.APP_URL.replace(/^http/, 'ws')],
          frameAncestors: ["'none'"], // nobody may frame us (clickjacking)
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
          upgradeInsecureRequests: env.NODE_ENV === 'production' ? [] : null,
        },
      },
    }),
  );
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

  app.use('/api', apiLimiter, apiRouter);

  if (options.webDist) serveWebApp(app, options.webDist);

  app.use(notFoundHandler); // must be after all routes
  app.use(errorHandler); // must be last
  return app;
}

/** Static files + SPA fallback. Registered after /api and BEFORE the 404 handler. */
function serveWebApp(app: express.Express, webDist: string) {
  // Vite gives assets hashed filenames, so they can be cached "forever".
  app.use(
    '/assets',
    express.static(path.join(webDist, 'assets'), {
      immutable: true,
      maxAge: '1y',
      fallthrough: false,
    }),
  );
  app.use(express.static(webDist, { index: false }));
  // Any other GET that isn't an API/socket call gets index.html; React Router takes over.
  app.get('/{*splat}', (req, res, next) => {
    if (req.path.startsWith('/api/') || req.path.startsWith('/socket.io/')) return next();
    res.setHeader('Cache-Control', 'no-cache'); // always pick up a new deploy
    res.sendFile(path.join(webDist, 'index.html'));
  });
}
