import { Router } from 'express';
import { changePasswordSchema, updateMeSchema, type MeResponse } from '@teamboard/shared';
import { User } from '../../db/models';
import { notFound } from '../../lib/errors';
import { validate, valid } from '../../middleware/validate';
import { changePassword } from '../auth/auth.service';
import { listMyWorkspaces } from '../workspaces/workspace.service';
import { toUserDto } from './user.dto';

export const meRouter = Router(); // mounted behind `authenticate`

meRouter.get('/', async (req, res) => {
  const user = await User.findById(req.userId).lean();
  if (!user) throw notFound();
  res.json({
    user: toUserDto(user),
    workspaces: await listMyWorkspaces(req.userId),
  } satisfies MeResponse);
});

const updateReq = { body: updateMeSchema };
meRouter.patch('/', validate(updateReq), async (req, res) => {
  const user = await User.findByIdAndUpdate(
    req.userId,
    { $set: valid(req, updateReq).body },
    { returnDocument: 'after', runValidators: true },
  ).lean();
  if (!user) throw notFound();
  res.json({ user: toUserDto(user) });
});

const pwReq = { body: changePasswordSchema };
meRouter.patch('/password', validate(pwReq), async (req, res) => {
  const { currentPassword, newPassword } = valid(req, pwReq).body;
  await changePassword(req.userId, req.sessionId, currentPassword, newPassword);
  res.json({ ok: true });
});
