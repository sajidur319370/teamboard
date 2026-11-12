import { Router } from 'express';
import { z } from 'zod';
import {
  createWorkspaceSchema,
  deleteWorkspaceSchema,
  slugSchema,
  updateWorkspaceSchema,
} from '@teamboard/shared';
import { authorize } from '../../middleware/authorize';
import { validate, valid } from '../../middleware/validate';
import * as svc from './workspace.service';

/** /api/workspaces: authenticated, NOT tenant-scoped (no workspace exists yet). */
export const workspacesRouter = Router();

workspacesRouter.get('/', async (req, res) => {
  res.json({ workspaces: await svc.listMyWorkspaces(req.userId) });
});

const createReq = { body: createWorkspaceSchema };
workspacesRouter.post('/', validate(createReq), async (req, res) => {
  res
    .status(201)
    .json({ workspace: await svc.createWorkspace(req.userId, valid(req, createReq).body) });
});

const checkReq = { query: z.object({ slug: z.string().max(100) }) };
workspacesRouter.get('/check-slug', validate(checkReq), async (req, res) => {
  const parsed = slugSchema.safeParse(valid(req, checkReq).query.slug);
  if (!parsed.success) {
    res.json({ available: false, reason: parsed.error.issues[0]?.message });
    return;
  }
  res.json({ available: await svc.isSlugAvailable(parsed.data) });
});

/**
 * /api/w/:slug: tenant-scoped (authenticate + resolveWorkspace already ran).
 * EVERY route here declares authorize(...) (FR-RBAC-05; enforced by test/route-audit.test.ts).
 * From Day 6 on, feature routers mount inside this one with mount(workspaceRouter, '/members', ...).
 */
export const workspaceRouter = Router({ mergeParams: true });

workspaceRouter.get('/', authorize('workspace:view'), async (req, res) => {
  res.json(await svc.getWorkspace(req.ctx));
});

const updateReq = { body: updateWorkspaceSchema };
workspaceRouter.patch('/', authorize('workspace:update'), validate(updateReq), async (req, res) => {
  res.json({ workspace: await svc.updateWorkspace(req.ctx, valid(req, updateReq).body) });
});

const deleteReq = { body: deleteWorkspaceSchema };
workspaceRouter.delete(
  '/',
  authorize('workspace:delete'),
  validate(deleteReq),
  async (req, res) => {
    await svc.softDeleteWorkspace(req.ctx, valid(req, deleteReq).body.confirmName);
    res.status(204).end();
  },
);
