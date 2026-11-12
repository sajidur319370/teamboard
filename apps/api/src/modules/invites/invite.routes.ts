import { Router } from 'express';
import { createInviteSchema, inviteIdParams, inviteTokenParams } from '@teamboard/shared';
import { authenticate } from '../../middleware/authenticate';
import { authorize } from '../../middleware/authorize';
import { validate, valid } from '../../middleware/validate';
import { oid } from '../../lib/ids';
import * as svc from './invite.service';

/** /api/w/:slug/invites: managing a workspace's invites (Admin+) */
export const invitesRouter = Router({ mergeParams: true });

invitesRouter.get('/', authorize('invite:view'), async (req, res) => {
  res.json({ invites: await svc.listInvites(req.ctx) });
});

const createReq = { body: createInviteSchema };
invitesRouter.post('/', authorize('invite:create'), validate(createReq), async (req, res) => {
  res.status(201).json(await svc.createInvite(req.ctx, valid(req, createReq).body));
});

const revokeReq = { params: inviteIdParams };
invitesRouter.delete(
  '/:inviteId',
  authorize('invite:revoke'),
  validate(revokeReq),
  async (req, res) => {
    await svc.revokeInvite(req.ctx, oid(valid(req, revokeReq).params.inviteId));
    res.status(204).end();
  },
);

/** /api/invites/:token: the link itself. Not tenant-scoped: the token is the only input. */
export const publicInvitesRouter = Router();

const tokenReq = { params: inviteTokenParams };
publicInvitesRouter.get('/:token', validate(tokenReq), async (req, res) => {
  res.json({ invite: await svc.previewInvite(valid(req, tokenReq).params.token) }); // guest OK
});

publicInvitesRouter.post('/:token/accept', authenticate, validate(tokenReq), async (req, res) => {
  res.json(await svc.acceptInvite(req.userId, valid(req, tokenReq).params.token));
});
