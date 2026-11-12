import { Router } from 'express';
import { authenticate } from './middleware/authenticate';
import { authRouter } from './modules/auth/auth.routes';
import { meRouter } from './modules/users/me.routes';

/** The API router, mounted at /api. Feature routers get mounted here, one per day. */
export const apiRouter = Router();
apiRouter.use('/auth', authRouter);
apiRouter.use('/me', authenticate, meRouter);
