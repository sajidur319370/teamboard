import type { RequestHandler } from 'express';
import { isRole } from '@teamboard/shared';
import { Membership, Workspace } from '../db/models';
import { notFound } from '../lib/errors';
import { makeCtx } from '../types/ctx';

/**
 * /api/w/:slug/... → req.ctx (queries.md §2.1, FR-RBAC-06).
 * A missing workspace and "you're not a member" give the SAME 404, so nothing leaks (NFR-SEC-02).
 */
export const resolveWorkspace: RequestHandler = async (req, _res, next) => {
  const slug = req.params.slug;
  if (typeof slug !== 'string') throw notFound();

  const ws = await Workspace.findOne({ slug, deletedAt: null }).select('_id settings').lean();
  if (!ws) throw notFound();

  // Never cached: role changes and removals apply on the very next request (FR-MEM-07).
  const m = await Membership.findOne({ workspaceId: ws._id, userId: req.userId })
    .select('role')
    .lean();
  if (!m || !isRole(m.role)) throw notFound();

  const cmid = req.get('x-client-mutation-id');
  req.ctx = makeCtx({
    userId: req.userId,
    workspaceId: ws._id,
    role: m.role,
    tz: ws.settings?.timezone ?? 'UTC',
    clientMutationId: cmid && cmid.length <= 64 ? cmid : undefined,
  });
  next();
};
