import type { Types } from 'mongoose';
import {
  ROLE_LEVEL,
  type CreateTaskInput,
  type MyTasksResponse,
  type TaskDto,
  type UpdateTaskInput,
} from '@teamboard/shared';
import { Activity, CARD_FIELDS, Project, Task } from '../../db/models';
import { withTransaction } from '../../db/transaction';
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors';
import { oid } from '../../lib/ids';
import { cleanText } from '../../lib/text';
import { retryOnRankCollision, uniqueKeyAfter } from '../../lib/rank';
import { retryable, withRetry } from '../../lib/retry';
import { activity } from '../../events/activity';
import { publish } from '../../events/publish';
import type { Ctx } from '../../types/ctx';
import { assertWritable, findProject } from '../projects/project.helpers';
import { assertAssignees, assertLabels, colRef, sameIdSet, taskRef } from './task.helpers';
import { toTaskCard, toTaskDto } from './task.dto';

const uniq = (ids: Types.ObjectId[]) => [...new Map(ids.map((i) => [String(i), i])).values()];

/** queries.md §8.1. Returns the full task. */
export async function createTask(ctx: Ctx, key: string, input: CreateTaskInput): Promise<TaskDto> {
  // 1. Validate everything BEFORE taking a number, so a rejected request leaves no gap.
  const p0 = await findProject(ctx, key);
  assertWritable(p0);
  const chosen = input.columnId
    ? p0.columns.find((c) => c._id.equals(input.columnId))
    : [...p0.columns]
        .filter((c) => c.category === 'todo')
        .sort((a, b) => a.position - b.position)[0];
  if (!chosen) throw badRequest('INVALID_COLUMN', 'That column is not on this board.');
  const assigneeIds = uniq((input.assigneeIds ?? []).map(oid));
  const labelIds = (input.labelIds ?? []).map(oid);
  await assertAssignees(ctx, assigneeIds);
  assertLabels(p0, labelIds);
  if (input.sprintId) throw badRequest('INVALID_SPRINT', 'Sprints arrive on Day 18.'); // Day 18

  // 2. Next number: atomic $inc, OUTSIDE the transaction, so 50 parallel creates don't all
  //    write-conflict on the project document (AC-TSK-01). A later failure leaves a gap (BR-05).
  const p = await Project.findOneAndUpdate(
    { _id: p0._id, workspaceId: ctx.workspaceId, archivedAt: null },
    { $inc: { taskCounter: 1 } },
    { returnDocument: 'after', projection: { taskCounter: 1, columns: 1, key: 1 } },
  ).lean();
  if (!p) {
    assertWritable(await findProject(ctx, key)); // archived (409) or deleted (404) meanwhile
    throw notFound();
  }
  // Re-check on the fresh document: the column may have been deleted in between.
  const column = p.columns.find((c) => c._id.equals(chosen._id));
  if (!column) throw badRequest('INVALID_COLUMN', 'That column was just deleted.');

  // 3+4. Bottom of the column, then insert + activity atomically. Ranks are unique per
  // column: if another write took this exact key a moment ago, recompute and try again.
  const task = await retryOnRankCollision(async () => {
    const last = await Task.findOne({
      workspaceId: ctx.workspaceId,
      projectId: p._id,
      columnId: column._id,
    })
      .sort({ rank: -1 })
      .select('rank')
      .lean();
    // Unique even if parallel creates read the same `last` (the number is unique per create).
    const rank = uniqueKeyAfter(last?.rank ?? null, p.taskCounter);

    return withTransaction(async (session) => {
      const [t] = await Task.create(
        [
          {
            workspaceId: ctx.workspaceId,
            projectId: p._id,
            number: p.taskCounter,
            title: cleanText(input.title),
            description: cleanText(input.description ?? ''),
            columnId: column._id,
            rank,
            assigneeIds,
            reporterId: ctx.userId,
            watcherIds: uniq([ctx.userId, ...assigneeIds]), // reporter + assignees
            priority: input.priority ?? 'none',
            dueDate: input.dueDate ?? null,
            labelIds,
            storyPoints: input.storyPoints ?? null,
            sprintId: null,
            completedAt: column.category === 'done' ? ctx.now() : null, // BR-07
          },
        ],
        { session },
      );
      await Activity.create(
        [
          activity(
            ctx,
            'task.created',
            { task: taskRef(t!, p), column: colRef(column) },
            { projectId: p._id, taskId: t!._id },
          ),
        ],
        { session },
      );
      return t!;
    });
  });

  const plain = task.toObject();
  await publish(ctx, [
    {
      type: 'task.created',
      projectId: p._id,
      task: toTaskCard(plain),
      assignedIds: assigneeIds.map(String),
    },
  ]);
  return toTaskDto(plain);
}

/** The ONLY fields a PATCH may change (mass-assignment allow-list, schema.md §11). */
type Editable =
  'title' | 'description' | 'assigneeIds' | 'priority' | 'dueDate' | 'labelIds' | 'storyPoints';

/** How a changed field is recorded in the activity log (ids as strings, no huge text). */
function changeMeta(field: Editable, from: unknown, to: unknown) {
  if (field === 'description') return { field }; // two copies of 10k chars help nobody
  if (field === 'labelIds') {
    return {
      field,
      from: (from as Types.ObjectId[]).map(String),
      to: (to as Types.ObjectId[]).map(String),
    };
  }
  return { field, from: from ?? null, to: to ?? null };
}

/** queries.md §8.3: field-level $set, CAS where activities depend on the old value. */
export async function updateTask(ctx: Ctx, taskId: Types.ObjectId, input: UpdateTaskInput) {
  return withRetry(async () => {
    const current = await Task.findOne({ _id: taskId, workspaceId: ctx.workspaceId }).lean();
    if (!current) throw notFound();
    const project = await Project.findOne({ _id: current.projectId, workspaceId: ctx.workspaceId })
      .select('key labels archivedAt')
      .lean();
    if (!project) throw notFound();
    assertWritable(project);

    // Allow-list copy (mass-assignment protection), normalised, and only REAL changes.
    const changes: Partial<Record<Editable, unknown>> = {};
    if (input.title !== undefined && cleanText(input.title) !== current.title) {
      changes.title = cleanText(input.title);
    }
    if (input.description !== undefined && cleanText(input.description) !== current.description) {
      changes.description = cleanText(input.description);
    }
    if (input.priority !== undefined && input.priority !== current.priority) {
      changes.priority = input.priority;
    }
    if (input.dueDate !== undefined && input.dueDate !== (current.dueDate ?? null)) {
      changes.dueDate = input.dueDate;
    }
    if (input.storyPoints !== undefined && input.storyPoints !== (current.storyPoints ?? null)) {
      changes.storyPoints = input.storyPoints;
    }
    let assigned: Types.ObjectId[] = [];
    let unassigned: Types.ObjectId[] = [];
    if (input.assigneeIds !== undefined) {
      const next = uniq(input.assigneeIds.map(oid));
      if (!sameIdSet(next, current.assigneeIds)) {
        const before = new Set(current.assigneeIds.map(String));
        const after = new Set(next.map(String));
        assigned = next.filter((id) => !before.has(String(id)));
        unassigned = current.assigneeIds.filter((id) => !after.has(String(id)));
        await assertAssignees(ctx, assigned); // only NEW ones: former members may stay (FR-TSK-10)
        changes.assigneeIds = next;
      }
    }
    if (input.labelIds !== undefined) {
      const next = input.labelIds.map(oid);
      if (!sameIdSet(next, current.labelIds)) {
        assertLabels(project, next);
        changes.labelIds = next;
      }
    }

    if (input.expectedVersion !== undefined && input.expectedVersion !== current.version) {
      // FR-TSK-04: the client edited an older version (the description editor sends this).
      throw conflict(
        'VERSION_CONFLICT',
        'This task was changed by someone else.',
        toTaskDto(current),
      );
    }
    const fields = Object.keys(changes) as Editable[];
    if (fields.length === 0) return toTaskDto(current); // nothing changed: no version bump

    // CAS: the old values that feed activities go into the filter.
    const cas: Record<string, unknown> = { version: current.version };

    const updated = await withTransaction(async (session) => {
      const t = await Task.findOneAndUpdate(
        { _id: taskId, workspaceId: ctx.workspaceId, ...cas },
        {
          $set: changes,
          $inc: { version: 1 },
          ...(assigned.length > 0 && { $addToSet: { watcherIds: { $each: assigned } } }), // FR-TSK-09
        },
        { returnDocument: 'after', runValidators: true, session },
      ).lean();
      if (!t) throw retryable(); // changed under us → withRetry re-reads and re-diffs

      const ref = { task: taskRef(t, project) };
      const refs = { projectId: t.projectId, taskId: t._id };
      const acts = fields
        .filter((f) => f !== 'assigneeIds')
        .map((f) =>
          activity(ctx, 'task.updated', { ...ref, ...changeMeta(f, current[f], changes[f]) }, refs),
        );
      // Day 18: a storyPoints change in an ACTIVE sprint carries scopeDelta/doneDelta (D6)
      for (const id of assigned) {
        acts.push(activity(ctx, 'task.assigned', { ...ref, user: { id: String(id) } }, refs));
      }
      for (const id of unassigned) {
        acts.push(activity(ctx, 'task.unassigned', { ...ref, user: { id: String(id) } }, refs));
      }
      await Activity.insertMany(acts, { session });
      return t;
    });

    await publish(ctx, [
      {
        type: 'task.updated',
        projectId: updated.projectId,
        task: toTaskCard(updated),
        changedFields: fields,
        assignedIds: assigned.map(String),
        unassignedIds: unassigned.map(String),
      },
    ]);
    return toTaskDto(updated);
  });
}

/** queries.md §8.4: deep link /w/:slug/p/:key/tasks/:number (FR-TSK-07). */
export async function getTaskByNumber(ctx: Ctx, key: string, number: number) {
  const p = await findProject(ctx, key);
  const t = await Task.findOne({ workspaceId: ctx.workspaceId, projectId: p._id, number }).lean();
  if (!t) throw notFound();
  return toTaskDto(t);
}

/** FR-TSK-05: Admin+ any task; a Member only tasks they reported. */
export async function deleteTask(ctx: Ctx, taskId: Types.ObjectId) {
  const t = await Task.findOne({ _id: taskId, workspaceId: ctx.workspaceId })
    .select('projectId reporterId number title')
    .lean();
  if (!t) throw notFound();
  if (ctx.roleLevel < ROLE_LEVEL.admin && !t.reporterId.equals(ctx.userId)) {
    throw forbidden('NOT_REPORTER', 'Only the reporter or an Admin can delete this task.');
  }
  const p = await Project.findOne({ _id: t.projectId, workspaceId: ctx.workspaceId })
    .select('key archivedAt')
    .lean();
  if (!p) throw notFound();
  assertWritable(p);

  await withTransaction(async (session) => {
    const deleted = await Task.findOneAndDelete(
      { _id: taskId, workspaceId: ctx.workspaceId },
      { session },
    ).lean();
    if (!deleted) throw notFound(); // deleted by a parallel request
    // Day 16: Comment.deleteMany · Day 17: Notification.deleteMany · Day 18: scope delta (D9)
    await Activity.create(
      [
        activity(
          ctx,
          'task.deleted',
          { task: taskRef(t, p) },
          { projectId: t.projectId, taskId: t._id },
        ),
      ],
      { session },
    );
  });
  await publish(ctx, [
    { type: 'task.deleted', projectId: t.projectId, taskId: String(t._id), number: t.number },
  ]);
}

/** queries.md §8.6 / FR-TSK-11: my open tasks in active projects, by due date (none last). */
export async function myTasks(ctx: Ctx): Promise<MyTasksResponse> {
  const projects = await Project.find({ workspaceId: ctx.workspaceId, archivedAt: null })
    .select('key name')
    .sort({ name: 1 })
    .lean();
  const rows = await Task.find({
    workspaceId: ctx.workspaceId,
    assigneeIds: ctx.userId,
    completedAt: null,
    projectId: { $in: projects.map((p) => p._id) },
  })
    .select(CARD_FIELDS)
    .sort({ dueDate: 1 })
    .limit(200)
    .lean();
  // MongoDB sorts null first: move "no due date" to the end.
  const tasks = [...rows.filter((t) => t.dueDate), ...rows.filter((t) => !t.dueDate)].map(
    toTaskCard,
  );
  const used = new Set(tasks.map((t) => t.projectId));
  return {
    tasks,
    projects: projects
      .filter((p) => used.has(String(p._id)))
      .map((p) => ({ id: String(p._id), key: p.key, name: p.name })),
  };
}
