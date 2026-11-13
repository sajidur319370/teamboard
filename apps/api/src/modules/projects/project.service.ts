import {
  LIMITS,
  type CreateProjectInput,
  type ProjectDto,
  type ProjectListItemDto,
  type UpdateProjectInput,
} from '@teamboard/shared';
import {
  Activity,
  Comment,
  DEFAULT_COLUMNS,
  Notification,
  Project,
  Sprint,
  Task,
} from '../../db/models';
import { withTransaction } from '../../db/transaction';
import { badRequest, conflict } from '../../lib/errors';
import { oid } from '../../lib/ids';
import { activity } from '../../events/activity';
import { publish } from '../../events/publish';
import type { Ctx } from '../../types/ctx';
import { assertLead, assertWritable, findProject } from './project.helpers';
import { toProjectDto } from './project.dto';

/** FR-PRJ-04 / queries.md §5.2: active projects (or all, with archived) + open-task counts. */
export async function listProjects(
  ctx: Ctx,
  includeArchived = false,
): Promise<ProjectListItemDto[]> {
  const projects = await Project.find({
    workspaceId: ctx.workspaceId,
    ...(includeArchived ? {} : { archivedAt: null }),
  })
    .select('name key leadId archivedAt')
    .sort({ name: 1 })
    .lean();
  if (projects.length === 0) return [];

  const openCounts = await Task.aggregate<{ _id: unknown; open: number }>([
    {
      $match: {
        workspaceId: ctx.workspaceId,
        projectId: { $in: projects.map((p) => p._id) },
        completedAt: null,
      },
    },
    { $group: { _id: '$projectId', open: { $sum: 1 } } },
  ]);
  const openBy = new Map(openCounts.map((c) => [String(c._id), c.open]));
  // queries.md §5.2: the running sprint of each project, one query
  const active = await Sprint.find({
    workspaceId: ctx.workspaceId,
    projectId: { $in: projects.map((p) => p._id) },
    state: 'active',
  })
    .select('projectId name')
    .lean();
  const activeBy = new Map(
    active.map((s) => [String(s.projectId), { id: String(s._id), name: s.name }]),
  );

  return projects.map((p) => ({
    id: String(p._id),
    key: p.key,
    name: p.name,
    leadId: p.leadId ? String(p.leadId) : null,
    openTasks: openBy.get(String(p._id)) ?? 0,
    activeSprint: activeBy.get(String(p._id)) ?? null,
    archivedAt: p.archivedAt?.toISOString() ?? null,
  }));
}

export async function getProject(ctx: Ctx, key: string): Promise<ProjectDto> {
  return toProjectDto(await findProject(ctx, key));
}

async function assertProjectLimit(ctx: Ctx) {
  const active = await Project.countDocuments({ workspaceId: ctx.workspaceId, archivedAt: null });
  if (active >= LIMITS.projectsPerWorkspace) {
    throw conflict(
      'PROJECT_LIMIT',
      `A workspace can have at most ${LIMITS.projectsPerWorkspace} active projects.`,
    );
  }
}

export async function createProject(ctx: Ctx, input: CreateProjectInput) {
  await assertProjectLimit(ctx); // FR-PRJ-09
  const leadId = input.leadId ? oid(input.leadId) : null;
  await assertLead(ctx, leadId);

  const project = await withTransaction(async (session) => {
    const [p] = await Project.create(
      [
        {
          workspaceId: ctx.workspaceId,
          name: input.name,
          key: input.key,
          description: input.description,
          leadId,
          columns: DEFAULT_COLUMNS.map((c) => ({ ...c })), // mutable copy of the readonly default
          createdBy: ctx.userId,
        },
      ],
      { session },
    ); // E11000 uniq_project_key → 409 KEY_TAKEN (also blocks keys of archived projects)
    await Activity.create(
      [
        activity(
          ctx,
          'project.created',
          { name: input.name, key: input.key },
          { projectId: p!._id },
        ),
      ],
      { session },
    );
    return p!;
  });

  const dto = toProjectDto(project.toObject());
  await publish(ctx, [{ type: 'project.changed', kind: 'created', project: dto }]);
  return dto;
}

/** FR-PRJ-05: name, description, lead. */
export async function updateProject(ctx: Ctx, key: string, input: UpdateProjectInput) {
  const p = await findProject(ctx, key);
  assertWritable(p);

  const $set: Record<string, unknown> = {};
  if (input.name !== undefined && input.name !== p.name) $set.name = input.name;
  if (input.description !== undefined && input.description !== p.description) {
    $set.description = input.description;
  }
  if (input.leadId !== undefined) {
    const leadId = input.leadId ? oid(input.leadId) : null;
    if (String(leadId) !== String(p.leadId ?? null)) {
      await assertLead(ctx, leadId);
      $set.leadId = leadId;
    }
  }
  if (Object.keys($set).length === 0) return toProjectDto(p); // nothing changed

  const updated = await withTransaction(async (session) => {
    const doc = await Project.findOneAndUpdate(
      { _id: p._id, workspaceId: ctx.workspaceId, archivedAt: null },
      { $set },
      { returnDocument: 'after', runValidators: true, session },
    ).lean();
    if (!doc) throw conflict('PROJECT_ARCHIVED', 'This project is archived and cannot be changed.');
    await Activity.create(
      [
        activity(
          ctx,
          'project.updated',
          { changes: Object.keys($set), name: doc.name, key: doc.key },
          { projectId: p._id },
        ),
      ],
      { session },
    );
    return doc;
  });
  const dto = toProjectDto(updated);
  await publish(ctx, [{ type: 'project.changed', kind: 'updated', project: dto }]);
  return dto;
}

/** FR-PRJ-06: archive / unarchive. Idempotent: no activity if nothing changes. */
export async function setArchived(ctx: Ctx, key: string, archived: boolean) {
  const p = await findProject(ctx, key);
  if (!!p.archivedAt === archived) return toProjectDto(p);
  if (!archived) await assertProjectLimit(ctx); // unarchiving adds an active project

  const updated = await withTransaction(async (session) => {
    const doc = await Project.findOneAndUpdate(
      { _id: p._id, workspaceId: ctx.workspaceId, archivedAt: archived ? null : { $ne: null } },
      { $set: { archivedAt: archived ? ctx.now() : null } },
      { returnDocument: 'after', session },
    ).lean();
    if (!doc) return null; // a parallel request did it first
    await Activity.create(
      [
        activity(
          ctx,
          archived ? 'project.archived' : 'project.unarchived',
          { name: p.name, key: p.key },
          { projectId: p._id },
        ),
      ],
      { session },
    );
    return doc;
  });
  if (!updated) return toProjectDto(await findProject(ctx, key));

  const dto = toProjectDto(updated);
  await publish(ctx, [
    { type: 'project.changed', kind: archived ? 'archived' : 'unarchived', project: dto },
  ]);
  return dto;
}

/** FR-PRJ-07: hard delete with its tasks and project-scoped activities (data-model.md §13). */
export async function deleteProject(ctx: Ctx, key: string, confirmKey: string) {
  const p = await findProject(ctx, key);
  if (confirmKey.trim().toUpperCase() !== p.key) {
    throw badRequest('CONFIRMATION_MISMATCH', 'Type the project key to confirm.');
  }

  await withTransaction(async (session) => {
    const scope = { workspaceId: ctx.workspaceId, projectId: p._id };
    await Task.deleteMany(scope, { session });
    await Comment.deleteMany(scope, { session });
    await Notification.deleteMany(scope, { session });
    await Sprint.deleteMany(scope, { session });
    await Activity.deleteMany(scope, { session });
    await Project.deleteOne({ _id: p._id, workspaceId: ctx.workspaceId }, { session });
    // Workspace-level (no projectId), so it survives as the record of what was deleted.
    await Activity.create([activity(ctx, 'project.deleted', { name: p.name, key: p.key })], {
      session,
    });
  });
  await publish(ctx, [{ type: 'project.changed', kind: 'deleted', project: toProjectDto(p) }]);
}
