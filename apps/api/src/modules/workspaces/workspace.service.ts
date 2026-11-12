import { Types } from 'mongoose';
import {
  LIMITS,
  isRole,
  type CreateWorkspaceInput,
  type UpdateWorkspaceInput,
  type WorkspaceResponse,
  type WorkspaceSummaryDto,
} from '@teamboard/shared';
import { Activity, Membership, User, Workspace } from '../../db/models';
import { withTransaction } from '../../db/transaction';
import { badRequest, conflict, notFound } from '../../lib/errors';
import { activity } from '../../events/activity';
import { publish } from '../../events/publish';
import { makeCtx, type Ctx } from '../../types/ctx';
import { toWorkspaceDto } from './workspace.dto';

/** GET /me and GET /workspaces (queries.md §2.2). */
export async function listMyWorkspaces(userId: Types.ObjectId): Promise<WorkspaceSummaryDto[]> {
  const memberships = await Membership.find({ userId })
    .setOptions({ skipTenantCheck: 'list-my-workspaces' }) // approved bypass (data-model.md §2.3)
    .select('workspaceId role')
    .lean();
  const workspaces = await Workspace.find({
    _id: { $in: memberships.map((m) => m.workspaceId) },
    deletedAt: null,
  })
    .select('name slug')
    .sort({ name: 1 })
    .lean();
  const roleOf = new Map(memberships.map((m) => [String(m.workspaceId), m.role]));
  return workspaces.flatMap((w) => {
    const role = roleOf.get(String(w._id));
    return isRole(role) ? [{ id: String(w._id), name: w.name, slug: w.slug, role }] : [];
  });
}

/** One transaction: workspace + owner membership + activity (queries.md §4.1). */
export async function createWorkspace(userId: Types.ObjectId, input: CreateWorkspaceInput) {
  const owned = await Membership.countDocuments({ userId, role: 'owner' }).setOptions({
    skipTenantCheck: 'workspace-limit', // approved bypass
  });
  if (owned >= LIMITS.workspacesPerUser) {
    throw conflict('WORKSPACE_LIMIT', 'You own the maximum number of workspaces.');
  }

  const user = await User.findById(userId).select('timezone').lean();
  const workspaceId = new Types.ObjectId(); // known up front so we can build ctx
  const ctx = makeCtx({ userId, workspaceId, role: 'owner', tz: user?.timezone ?? 'UTC' });

  const ws = await withTransaction(async (session) => {
    const [doc] = await Workspace.create(
      [
        {
          _id: workspaceId,
          name: input.name,
          slug: input.slug,
          ownerId: userId,
          createdBy: userId,
          settings: { timezone: ctx.tz }, // FR-WS-06: default from the creator's timezone
        },
      ],
      { session },
    ); // E11000 uniq_slug → 409 SLUG_TAKEN
    await Membership.create([{ workspaceId, userId, role: 'owner' }], { session });
    await Activity.create([activity(ctx, 'workspace.created', { name: input.name })], {
      session,
    });
    return doc!;
  });
  return toWorkspaceDto(ws);
}

export async function getWorkspace(ctx: Ctx): Promise<WorkspaceResponse> {
  const ws = await Workspace.findOne({ _id: ctx.workspaceId, deletedAt: null }).lean();
  if (!ws) throw notFound();
  return { workspace: toWorkspaceDto(ws), role: ctx.role };
}

export async function updateWorkspace(ctx: Ctx, input: UpdateWorkspaceInput) {
  const $set: Record<string, unknown> = {};
  if (input.name !== undefined) $set.name = input.name;
  if (input.timezone !== undefined) $set['settings.timezone'] = input.timezone;
  if (input.weekStartsOn !== undefined) $set['settings.weekStartsOn'] = input.weekStartsOn;
  if (input.workingDays !== undefined) $set['settings.workingDays'] = input.workingDays;
  if (Object.keys($set).length === 0) return (await getWorkspace(ctx)).workspace; // nothing to do

  const ws = await withTransaction(async (session) => {
    const doc = await Workspace.findOneAndUpdate(
      { _id: ctx.workspaceId, deletedAt: null },
      { $set },
      { returnDocument: 'after', runValidators: true, session },
    ).lean();
    if (!doc) throw notFound();
    await Activity.create([activity(ctx, 'workspace.updated', { changes: input })], { session });
    return doc;
  });
  return toWorkspaceDto(ws);
}

/** FR-WS-08: soft delete. Every member gets 404 from the next request on (AC-WS-02). */
export async function softDeleteWorkspace(ctx: Ctx, confirmName: string) {
  const ws = await Workspace.findOne({ _id: ctx.workspaceId, deletedAt: null })
    .select('name')
    .lean();
  if (!ws) throw notFound();
  if (ws.name !== confirmName) {
    throw badRequest('CONFIRMATION_MISMATCH', 'Type the workspace name exactly to confirm.');
  }
  const memberIds = (
    await Membership.find({ workspaceId: ctx.workspaceId }).select('userId').lean()
  ).map((m) => m.userId);
  const res = await Workspace.updateOne(
    { _id: ctx.workspaceId, deletedAt: null },
    { $set: { deletedAt: ctx.now() } },
  );
  if (res.modifiedCount === 0) throw notFound(); // deleted by a parallel request
  // Day 14: the socket layer turns this into "membership:revoked" for every member
  await publish(ctx, [{ type: 'workspace.deleted', memberIds }]);
}

export async function isSlugAvailable(slug: string) {
  // Soft-deleted workspaces still hold their slug, and this query sees them too.
  return !(await Workspace.exists({ slug }));
}
