import { Router } from 'express';
import { authenticate } from './middleware/authenticate';
import { resolveWorkspace } from './middleware/resolveWorkspace';
import { authRouter } from './modules/auth/auth.routes';
import { meRouter } from './modules/users/me.routes';
import { workspaceRouter, workspacesRouter } from './modules/workspaces/workspace.routes';

/** The API router, mounted at /api. */
export const apiRouter = Router();
apiRouter.use('/auth', authRouter);
apiRouter.use('/me', authenticate, meRouter);
apiRouter.use('/workspaces', authenticate, workspacesRouter);
// Tenant-scoped: authenticate → resolveWorkspace (req.ctx) → per-route authorize(...)
apiRouter.use('/w/:slug', authenticate, resolveWorkspace, workspaceRouter);
