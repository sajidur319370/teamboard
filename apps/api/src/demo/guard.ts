import type { RequestHandler } from 'express';
import type { Types } from 'mongoose';
import { DEMO_WORKSPACE_SLUG, isDemoEmail } from '@teamboard/shared';
import { env } from '../config/env';
import { User } from '../db/models';
import { forbidden } from '../lib/errors';

/**
 * DEMO_MODE (a public portfolio demo): the demo accounts are shared by every visitor, so
 * nothing one visitor does may lock the next one out or break the demo for them.
 * Everyday work (cards, comments, tasks, sprints) stays open; the daily reset
 * (./autoReset.ts) cleans it up.
 */
export const isDemoMode = () => env.DEMO_MODE;

/** Demo accounts can't change their password or profile, or sign everyone else out. */
export async function assertNotDemoAccount(userId: Types.ObjectId) {
  if (!env.DEMO_MODE) return;
  const user = await User.findById(userId).select('email').lean();
  if (user && isDemoEmail(user.email)) {
    throw forbidden(
      'DEMO_ACCOUNT',
      'Demo accounts are shared, so they can’t be changed. Create your own account to try this.',
    );
  }
}

const LOCKED =
  'This is locked in the demo so it keeps working for the next visitor. Create your own workspace to try it.';

/** Requests (relative to /api/w/:slug) that would break the shared demo workspace. */
const PROTECTED: [method: string, path: RegExp][] = [
  ['PATCH', /^\/?$/], // rename / settings (the timezone changes every report)
  ['DELETE', /^\/?$/], // delete the workspace
  ['POST', /^\/leave\/?$/],
  ['POST', /^\/transfer-ownership\/?$/],
  ['PATCH', /^\/members\/[^/]+\/?$/], // change someone's role
  ['DELETE', /^\/members\/[^/]+\/?$/], // remove someone
  ['POST', /^\/invites\/?$/], // invite links would let strangers in
  ['DELETE', /^\/projects\/[^/]+\/?$/], // delete a project
  ['POST', /^\/projects\/[^/]+\/archive\/?$/], // archive a project (read-only for everyone)
];

/** Runs after resolveWorkspace: blocks the PROTECTED requests in the demo workspace. */
export const demoWorkspaceGuard: RequestHandler = (req, _res, next) => {
  if (!env.DEMO_MODE || req.params.slug !== DEMO_WORKSPACE_SLUG) return next();
  const blocked = PROTECTED.some(([method, path]) => method === req.method && path.test(req.path));
  next(blocked ? forbidden('DEMO_PROTECTED', LOCKED) : undefined);
};
