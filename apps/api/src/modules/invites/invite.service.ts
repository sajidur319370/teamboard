import type { Types } from 'mongoose';
import {
  LIMITS,
  grantableRoles,
  isRole,
  type AcceptInviteResponse,
  type CreateInviteInput,
  type CreateInviteResponse,
  type InviteDto,
  type InvitePreviewDto,
} from '@teamboard/shared';
import { Activity, Invite, Membership, User, Workspace, inviteStatus } from '../../db/models';
import type { InviteDoc } from '../../db/models';
import { withTransaction } from '../../db/transaction';
import { env } from '../../config/env';
import { conflict, forbidden, gone, notFound } from '../../lib/errors';
import { randomToken, sha256 } from '../../lib/crypto';
import { addDays } from '../../lib/dates';
import { isDuplicateKey } from '../../lib/ids';
import { activity } from '../../events/activity';
import { publish } from '../../events/publish';
import { makeCtx, type Ctx } from '../../types/ctx';
import { memberDto } from '../members/member.service';

type InviteRow = InviteDoc & { _id: Types.ObjectId; createdAt: Date };

const toInviteDto = (i: InviteRow, now?: Date): InviteDto => ({
  id: String(i._id),
  role: isRole(i.role) ? i.role : 'viewer',
  email: i.email ?? null,
  maxUses: i.maxUses ?? 10,
  uses: i.uses ?? 0,
  expiresAt: i.expiresAt.toISOString(),
  createdAt: i.createdAt.toISOString(),
  status: inviteStatus(i, now),
  createdBy: String(i.createdBy),
});

export async function createInvite(
  ctx: Ctx,
  input: CreateInviteInput,
): Promise<CreateInviteResponse> {
  if (!grantableRoles(ctx.role).includes(input.role)) {
    throw forbidden('ROLE_CEILING', `You can't invite people as ${input.role}.`); // FR-RBAC-04
  }
  const token = randomToken(32); // shown ONCE, never stored in plain text (FR-INV-02)
  const invite = await withTransaction(async (session) => {
    const [doc] = await Invite.create(
      [
        {
          workspaceId: ctx.workspaceId,
          tokenHash: sha256(token),
          role: input.role,
          email: input.email ?? null,
          maxUses: input.maxUses,
          expiresAt: addDays(ctx.now(), input.expiresInDays),
          createdBy: ctx.userId,
        },
      ],
      { session },
    );
    await Activity.create(
      [activity(ctx, 'invite.created', { role: input.role }, { entityId: doc!._id })],
      { session },
    );
    return doc!;
  });
  return {
    invite: toInviteDto(invite.toObject() as InviteRow, ctx.now()),
    url: `${env.APP_URL}/invite/${token}`,
  };
}

/** FR-INV-03: active invites only, newest first. */
export async function listInvites(ctx: Ctx): Promise<InviteDto[]> {
  const now = ctx.now();
  const rows = await Invite.find({
    workspaceId: ctx.workspaceId,
    revokedAt: null,
    expiresAt: { $gt: now },
    $expr: { $lt: ['$uses', '$maxUses'] },
  })
    .sort({ createdAt: -1 })
    .lean<InviteRow[]>();
  return rows.map((r) => toInviteDto(r, now));
}

/** FR-INV-04: an Admin can revoke any invite of a role they could create. Idempotent. */
export async function revokeInvite(ctx: Ctx, inviteId: Types.ObjectId) {
  const invite = await Invite.findOne({ _id: inviteId, workspaceId: ctx.workspaceId })
    .select('role revokedAt')
    .lean();
  if (!invite || !isRole(invite.role)) throw notFound();
  if (!grantableRoles(ctx.role).includes(invite.role)) {
    throw forbidden('ROLE_CEILING', `You can't revoke ${invite.role} invites.`);
  }
  if (invite.revokedAt) return; // already revoked: nothing to do

  await withTransaction(async (session) => {
    const res = await Invite.updateOne(
      { _id: inviteId, workspaceId: ctx.workspaceId, revokedAt: null },
      { $set: { revokedAt: ctx.now() } },
      { session },
    );
    if (res.modifiedCount === 0) return; // revoked by someone else a moment ago
    await Activity.create(
      [activity(ctx, 'invite.revoked', { role: invite.role }, { entityId: inviteId })],
      { session },
    );
  });
}

/** The token is the only input, so this is an approved guard bypass (data-model.md §2.3). */
function findByToken(token: string) {
  return Invite.findOne({ tokenHash: sha256(token) })
    .setOptions({ skipTenantCheck: 'invite-token-lookup' })
    .lean<InviteRow>();
}

/** FR-INV-05: no login needed. The holder already has the token, so showing status leaks nothing. */
export async function previewInvite(token: string): Promise<InvitePreviewDto> {
  const invite = await findByToken(token);
  if (!invite || !isRole(invite.role)) throw notFound();
  const [ws, inviter] = await Promise.all([
    Workspace.findOne({ _id: invite.workspaceId, deletedAt: null }).select('name slug').lean(),
    User.findById(invite.createdBy).select('name').lean(),
  ]);
  if (!ws) throw notFound();
  return {
    workspace: { name: ws.name, slug: ws.slug },
    role: invite.role,
    status: inviteStatus(invite),
    emailLocked: !!invite.email,
    inviterName: inviter?.name ?? 'Someone',
  };
}

/** FR-INV-06: checks in the required order, then claims one use atomically (CAS). */
export async function acceptInvite(
  userId: Types.ObjectId,
  token: string,
): Promise<AcceptInviteResponse> {
  const now = new Date();
  const invite = await findByToken(token);
  if (!invite || !isRole(invite.role)) throw notFound();

  const status = inviteStatus(invite, now); // revoked → expired → used_up
  if (status !== 'active') {
    throw gone(`INVITE_${status.toUpperCase()}`, 'This invite is no longer valid.');
  }

  const user = await User.findById(userId).select('email').lean();
  if (!user) throw notFound();
  if (invite.email && invite.email !== user.email) {
    throw forbidden('INVITE_EMAIL_MISMATCH', 'This invite is for a different email address.');
  }

  const ws = await Workspace.findOne({ _id: invite.workspaceId, deletedAt: null })
    .select('slug settings')
    .lean();
  if (!ws) throw notFound();

  if (await Membership.exists({ workspaceId: invite.workspaceId, userId })) {
    return { slug: ws.slug }; // FR-INV-07: already a member: no role change, no use consumed
  }
  const count = await Membership.countDocuments({ workspaceId: invite.workspaceId });
  if (count >= LIMITS.membersPerWorkspace) {
    throw conflict('MEMBER_LIMIT', 'This workspace is full.'); // FR-MEM-08
  }

  const ctx = makeCtx({
    userId,
    workspaceId: invite.workspaceId,
    role: invite.role,
    tz: ws.settings?.timezone ?? 'UTC',
  });

  try {
    await withTransaction(async (session) => {
      // Claim one use atomically: two people accepting the last use → only one matches (I8).
      const claimed = await Invite.findOneAndUpdate(
        {
          _id: invite._id,
          workspaceId: invite.workspaceId,
          revokedAt: null,
          expiresAt: { $gt: now },
          $expr: { $lt: ['$uses', '$maxUses'] },
        },
        { $inc: { uses: 1 } },
        { session },
      );
      if (!claimed) throw gone('INVITE_USED_UP', 'This invite has been used up.');

      await Membership.create(
        [
          {
            workspaceId: invite.workspaceId,
            userId,
            role: invite.role,
            invitedBy: invite.createdBy,
            inviteId: invite._id,
          },
        ],
        { session },
      );
      await Activity.create([activity(ctx, 'member.joined', { role: invite.role })], { session });
    });
  } catch (err) {
    // Double click: the other request already made us a member. The use was rolled back.
    if (isDuplicateKey(err, 'uniq_member')) return { slug: ws.slug };
    throw err;
  }

  const member = await memberDto(ctx, userId);
  await publish(ctx, [{ type: 'member.joined', member, invitedBy: invite.createdBy }]); // N7 on Day 17
  return { slug: ws.slug };
}
