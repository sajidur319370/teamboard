import { Router } from 'express';
import { changeRoleSchema, transferOwnershipSchema, userIdParams } from '@teamboard/shared';
import { authorize } from '../../middleware/authorize';
import { validate, valid } from '../../middleware/validate';
import { oid } from '../../lib/ids';
import * as svc from './member.service';

/** /api/w/:slug/members */
export const membersRouter = Router({ mergeParams: true });

membersRouter.get('/', authorize('member:view'), async (req, res) => {
  res.json({ members: await svc.listMembers(req.ctx) });
});

const roleReq = { params: userIdParams, body: changeRoleSchema };
membersRouter.patch(
  '/:userId',
  authorize('member:updateRole'),
  validate(roleReq),
  async (req, res) => {
    const { params, body } = valid(req, roleReq);
    res.json({ member: await svc.changeRole(req.ctx, oid(params.userId), body.role) });
  },
);

const removeReq = { params: userIdParams };
membersRouter.delete(
  '/:userId',
  authorize('member:remove'),
  validate(removeReq),
  async (req, res) => {
    await svc.removeMember(req.ctx, oid(valid(req, removeReq).params.userId));
    res.status(204).end();
  },
);

/** /api/w/:slug/leave and /transfer-ownership (mounted at the workspace root) */
export const workspaceMemberActions = Router({ mergeParams: true });

workspaceMemberActions.post('/leave', authorize('member:leave'), async (req, res) => {
  await svc.leave(req.ctx);
  res.status(204).end();
});

const transferReq = { body: transferOwnershipSchema };
workspaceMemberActions.post(
  '/transfer-ownership',
  authorize('workspace:transferOwnership'),
  validate(transferReq),
  async (req, res) => {
    const { userId, password } = valid(req, transferReq).body;
    await svc.transferOwnership(req.ctx, oid(userId), password);
    res.status(204).end();
  },
);
