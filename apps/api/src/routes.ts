import { Router } from 'express';
import { authenticate } from './middleware/authenticate';
import { resolveWorkspace } from './middleware/resolveWorkspace';
import { authRouter } from './modules/auth/auth.routes';
import { publicInvitesRouter } from './modules/invites/invite.routes';
import { meRouter } from './modules/users/me.routes';
import { workspacesRouter } from './modules/workspaces/workspace.routes';
import { tenantRouter } from './tenantRouter';

/** The API router, mounted at /api. */
export const apiRouter = Router();
apiRouter.use('/auth', authRouter);
apiRouter.use('/me', authenticate, meRouter);
apiRouter.use('/workspaces', authenticate, workspacesRouter);
apiRouter.use('/invites', publicInvitesRouter); // preview is public; accept authenticates itself
// Tenant-scoped: authenticate → resolveWorkspace (req.ctx) → per-route authorize(...)
apiRouter.use('/w/:slug', authenticate, resolveWorkspace, tenantRouter);
