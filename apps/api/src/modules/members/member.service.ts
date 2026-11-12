import type { Types } from 'mongoose';
import {
  grantableRoles,
  isPaletteColor,
  isRole,
  rolesBelow,
  type MemberDto,
  type Role,
} from '@teamboard/shared';
import { Activity, Membership, User, Workspace } from '../../db/models';
import { withTransaction } from '../../db/transaction';
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors';
import { verifyPassword } from '../../lib/password';
import { activity } from '../../events/activity';
import { publish } from '../../events/publish';
import type { Ctx } from '../../types/ctx';

type MemberRow = {
  userId: Types.ObjectId;
  name: string;
  email: string;
  avatarColor?: string | null;
  role: string;
  joinedAt: Date;
};

const toMemberDto = (r: MemberRow): MemberDto => ({
  userId: String(r.userId),
  name: r.name,
  email: r.email,
  avatarColor: isPaletteColor(r.avatarColor) ? r.avatarColor : 'blue',
  role: isRole(r.role) ? r.role : 'viewer',
  joinedAt: r.joinedAt.toISOString(),
});

/** queries.md §4.2: one aggregation joins memberships to user summaries. */
export async function listMembers(ctx: Ctx): Promise<MemberDto[]> {
  const rows = await Membership.aggregate<MemberRow>([
    { $match: { workspaceId: ctx.workspaceId } }, // the guard requires this first
    {
      $lookup: {
        from: 'users',
        localField: 'userId',
        foreignField: '_id',
        pipeline: [{ $project: { name: 1, email: 1, avatarColor: 1 } }],
        as: 'user',
      },
    },
    { $unwind: '$user' },
    {
      $project: {
        _id: 0,
        userId: 1,
        role: 1,
        joinedAt: 1,
        name: '$user.name',
        email: '$user.email',
        avatarColor: '$user.avatarColor',
      },
    },
    { $sort: { name: 1, userId: 1 } },
  ]);
  return rows.map(toMemberDto);
}

export async function memberDto(ctx: Ctx, userId: Types.ObjectId): Promise<MemberDto> {
  const [m, u] = await Promise.all([
    Membership.findOne({ workspaceId: ctx.workspaceId, userId }).select('role joinedAt').lean(),
    User.findById(userId).select('name email avatarColor').lean(),
  ]);
  if (!m || !u) throw notFound();
  return toMemberDto({ userId, ...u, role: m.role, joinedAt: m.joinedAt });
}

/** Load the target's membership; tell 404 (not in this workspace) apart from 403 (above my ceiling). */
async function targetOr404(ctx: Ctx, userId: Types.ObjectId) {
  const m = await Membership.findOne({ workspaceId: ctx.workspaceId, userId })
    .select('role')
    .lean();
  if (!m || !isRole(m.role)) throw notFound();
  return m.role;
}

export async function changeRole(ctx: Ctx, targetUserId: Types.ObjectId, newRole: Role) {
  if (targetUserId.equals(ctx.userId)) {
    throw forbidden('CANNOT_CHANGE_OWN_ROLE', "You can't change your own role."); // FR-RBAC-03
  }
  const from = await targetOr404(ctx, targetUserId);
  if (!grantableRoles(ctx.role).includes(newRole)) {
    throw forbidden('ROLE_CEILING', `You can't grant the ${newRole} role.`); // FR-RBAC-02
  }
  if (!rolesBelow(ctx.role).includes(from)) {
    throw forbidden('ROLE_CEILING', "You can't change the role of someone at or above your level."); // FR-RBAC-01
  }
  if (from === newRole) return memberDto(ctx, targetUserId); // no-op: no activity, no event

  await withTransaction(async (session) => {
    // Ceiling INSIDE the filter: atomic even if someone else promotes the target meanwhile.
    const updated = await Membership.findOneAndUpdate(
      { workspaceId: ctx.workspaceId, userId: targetUserId, role: { $in: rolesBelow(ctx.role) } },
      { $set: { role: newRole } },
      { session },
    ).lean();
    if (!updated) throw forbidden('ROLE_CEILING', 'Their role changed meanwhile. Try again.');
    await Activity.create(
      [
        activity(ctx, 'member.role_changed', {
          user: { id: String(targetUserId) },
          from,
          to: newRole,
        }),
      ],
      { session },
    );
  });

  const member = await memberDto(ctx, targetUserId);
  await publish(ctx, [{ type: 'member.roleChanged', member, from }]);
  return member;
}

export async function removeMember(ctx: Ctx, targetUserId: Types.ObjectId) {
  if (targetUserId.equals(ctx.userId)) {
    throw badRequest('USE_LEAVE', 'Use "Leave workspace" instead.');
  }
  await targetOr404(ctx, targetUserId);

  await withTransaction(async (session) => {
    const removed = await Membership.findOneAndDelete(
      { workspaceId: ctx.workspaceId, userId: targetUserId, role: { $in: rolesBelow(ctx.role) } },
      { session },
    ).lean();
    if (!removed) {
      // Exists (we checked) but not below me: Admin vs Admin, anyone vs Owner (BR-03, BR-04).
      throw forbidden('ROLE_CEILING', "You can't remove someone at or above your level.");
    }
    await Activity.create(
      [activity(ctx, 'member.removed', { user: { id: String(targetUserId) }, role: removed.role })],
      { session },
    );
  });
  await publish(ctx, [{ type: 'member.removed', userId: targetUserId, reason: 'removed' }]);
}

export async function leave(ctx: Ctx) {
  if (ctx.role === 'owner') {
    throw conflict('OWNER_MUST_TRANSFER', 'Transfer ownership before leaving.'); // BR-04
  }
  await withTransaction(async (session) => {
    await Membership.deleteOne({ workspaceId: ctx.workspaceId, userId: ctx.userId }, { session });
    await Activity.create([activity(ctx, 'member.left', { role: ctx.role })], { session });
  });
  await publish(ctx, [{ type: 'member.removed', userId: ctx.userId, reason: 'left' }]);
}

/** FR-MEM-05 / queries.md §4.4: the new Owner must be an Admin; password re-entry required. */
export async function transferOwnership(ctx: Ctx, targetUserId: Types.ObjectId, password: string) {
  if (targetUserId.equals(ctx.userId)) {
    throw badRequest('TARGET_MUST_BE_ADMIN', 'Choose another member to hand ownership to.');
  }
  const me = await User.findById(ctx.userId).select('+passwordHash').lean();
  if (!me || !(await verifyPassword(password, me.passwordHash))) {
    throw badRequest('WRONG_PASSWORD', 'Incorrect password.');
  }

  await withTransaction(async (session) => {
    // 1. Demote FIRST: the partial unique index "one_owner_per_workspace" is checked per statement.
    const demoted = await Membership.updateOne(
      { workspaceId: ctx.workspaceId, userId: ctx.userId, role: 'owner' },
      { $set: { role: 'admin' } },
      { session },
    );
    if (demoted.modifiedCount !== 1) throw forbidden();

    // 2. Promote the target (must currently be an Admin). Throwing here rolls back step 1.
    const promoted = await Membership.updateOne(
      { workspaceId: ctx.workspaceId, userId: targetUserId, role: 'admin' },
      { $set: { role: 'owner' } },
      { session },
    );
    if (promoted.modifiedCount !== 1) {
      throw badRequest('TARGET_MUST_BE_ADMIN', 'The new owner must be an Admin of this workspace.');
    }

    await Workspace.updateOne(
      { _id: ctx.workspaceId },
      { $set: { ownerId: targetUserId } },
      { session },
    );
    await Activity.create(
      [
        activity(ctx, 'ownership.transferred', {
          from: String(ctx.userId),
          to: String(targetUserId),
        }),
      ],
      { session },
    );
  });
  await publish(ctx, [
    { type: 'ownership.transferred', fromUserId: ctx.userId, toUserId: targetUserId },
  ]);
}
