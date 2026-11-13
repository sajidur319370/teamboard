import { generateKeyBetween, generateNKeysBetween } from 'fractional-indexing';
import type { Types } from 'mongoose';
import { LIMITS, type MoveTaskInput, type MoveTaskResponse } from '@teamboard/shared';
import { Activity, Project, Task } from '../../db/models';
import { withTransaction } from '../../db/transaction';
import { tenantBulkWrite } from '../../db/tenantBulkWrite';
import { badRequest, notFound } from '../../lib/errors';
import { oid } from '../../lib/ids';
import { logger } from '../../lib/logger';
import { retryOnRankCollision } from '../../lib/rank';
import { retryable, withRetry } from '../../lib/retry';
import { activity } from '../../events/activity';
import { publish } from '../../events/publish';
import type { Ctx } from '../../types/ctx';
import { assertWritable } from '../projects/project.helpers';
import { colRef, taskRef } from './task.helpers';
import { toTaskCard } from './task.dto';

type Neighbor = { _id: Types.ObjectId; columnId: Types.ObjectId; rank: string };

/**
 * queries.md §6.2: anchor on ONE neighbour and read the other side from the database NOW.
 * Using both client-supplied neighbours could pass a stale pair (or a pair that is no longer
 * adjacent) to generateKeyBetween; reading "whatever is currently next to it" can't.
 */
async function computeRank(
  ctx: Ctx,
  projectId: Types.ObjectId,
  columnId: Types.ObjectId,
  taskId: Types.ObjectId,
  prev?: Neighbor,
  next?: Neighbor,
): Promise<string> {
  const col = { workspaceId: ctx.workspaceId, projectId, columnId, _id: { $ne: taskId } };

  if (prev) {
    const after = await Task.findOne({ ...col, rank: { $gt: prev.rank } })
      .sort({ rank: 1 })
      .select('rank')
      .lean();
    return generateKeyBetween(prev.rank, after?.rank ?? null);
  }
  if (next) {
    const before = await Task.findOne({ ...col, rank: { $lt: next.rank } })
      .sort({ rank: -1 })
      .select('rank')
      .lean();
    return generateKeyBetween(before?.rank ?? null, next.rank);
  }
  // No usable neighbours: dropped into an empty column, or both neighbours went stale → bottom.
  const last = await Task.findOne(col).sort({ rank: -1 }).select('rank').lean();
  return generateKeyBetween(last?.rank ?? null, null);
}

/** AC-ORD-03: neighbours must be tasks of the SAME project. */
async function loadNeighbors(
  ctx: Ctx,
  task: { _id: Types.ObjectId; projectId: Types.ObjectId },
  ids: string[],
): Promise<Neighbor[]> {
  if (ids.length === 0) return [];
  if (ids.some((id) => id === String(task._id))) {
    throw badRequest('INVALID_NEIGHBOR', 'A card cannot be its own neighbour.');
  }
  const found = await Task.find({
    _id: { $in: ids.map(oid) },
    workspaceId: ctx.workspaceId,
    projectId: task.projectId,
  })
    .select('columnId rank')
    .lean<Neighbor[]>();
  if (found.length !== new Set(ids).size) {
    // Another project of MY workspace → 400. Doesn't exist, or another workspace → 404.
    const missing = ids.filter((id) => !found.some((f) => String(f._id) === id));
    const elsewhere = await Task.exists({
      _id: { $in: missing.map(oid) },
      workspaceId: ctx.workspaceId,
    });
    throw elsewhere
      ? badRequest('INVALID_NEIGHBOR', 'That card is in another project.')
      : notFound();
  }
  return found;
}

type MoveResult =
  | { noop: true; task: MoveTaskResponse['task'] }
  | {
      noop: false;
      task: MoveTaskResponse['task'];
      rank: string;
      fromColumnId: string;
      projectId: Types.ObjectId;
    };

/** PATCH /tasks/:taskId/move: writes EXACTLY ONE task document (FR-ORD, queries.md §6). */
export async function moveTask(
  ctx: Ctx,
  taskId: Types.ObjectId,
  input: MoveTaskInput,
): Promise<MoveTaskResponse> {
  const toColumnId = oid(input.toColumnId);

  // withRetry: the version CAS lost (someone moved/edited the card meanwhile).
  // retryOnRankCollision: a concurrent drop took the exact same key (uniq_column_rank).
  // Both re-run everything from a fresh read.
  const result: MoveResult = await withRetry(() =>
    retryOnRankCollision(async (): Promise<MoveResult> => {
      // ---- 6.1 load and validate ----
      const task = await Task.findOne({ _id: taskId, workspaceId: ctx.workspaceId })
        .select(
          'projectId columnId rank assigneeIds priority dueDate labelIds storyPoints sprintId completedAt commentCount version number title',
        )
        .lean();
      if (!task) throw notFound();

      const project = await Project.findOne({ _id: task.projectId, workspaceId: ctx.workspaceId })
        .select('key columns archivedAt')
        .lean();
      if (!project) throw notFound();
      assertWritable(project);
      const toCol = project.columns.find((c) => c._id.equals(toColumnId));
      if (!toCol) throw badRequest('INVALID_COLUMN', 'That column is not on this board.'); // E3
      // The task's own column can be gone (the create-vs-delete-column race): treat it as todo.
      const fromCol = project.columns.find((c) => c._id.equals(task.columnId)) ?? {
        _id: task.columnId,
        name: '(deleted column)',
        category: 'todo',
      };

      const neighborIds = [input.prevTaskId, input.nextTaskId].filter((x): x is string => !!x);
      const found = await loadNeighbors(ctx, task, neighborIds);
      // A neighbour that is now in ANOTHER column moved after the client rendered:
      // stale, not invalid → ignore it and use the other one (or the bottom).
      const inTarget = (id: string | null) =>
        found.find((t) => String(t._id) === id && t.columnId.equals(toColumnId));
      const prev = inTarget(input.prevTaskId);
      const next = inTarget(input.nextTaskId);

      // ---- no-op (FR-ORD-08): dropped where it already is ----
      const sameColumn = task.columnId.equals(toColumnId);
      if (sameColumn) {
        const stillBetween = (!prev || prev.rank < task.rank) && (!next || task.rank < next.rank);
        const alone =
          !input.prevTaskId &&
          !input.nextTaskId &&
          !(await Task.exists({
            workspaceId: ctx.workspaceId,
            projectId: task.projectId,
            columnId: toColumnId,
            _id: { $ne: task._id },
          }));
        if ((stillBetween && (prev || next)) || alone)
          return { noop: true, task: toTaskCard(task) };
      }

      // ---- 6.2 rank ----
      const rank = await computeRank(ctx, task.projectId, toColumnId, task._id, prev, next);

      // ---- 6.3 write ONE task document, CAS on version ----
      const intoDone = toCol.category === 'done' && fromCol.category !== 'done';
      const outOfDone = fromCol.category === 'done' && toCol.category !== 'done';

      const updated = await withTransaction(async (session) => {
        const t = await Task.findOneAndUpdate(
          { _id: taskId, workspaceId: ctx.workspaceId, version: task.version }, // CAS (edge case E1)
          {
            $set: {
              columnId: toColumnId,
              rank,
              ...(intoDone && { completedAt: ctx.now() }),
              ...(outOfDone && { completedAt: null }),
            },
            $inc: { version: 1 },
          },
          { returnDocument: 'after', session },
        ).lean();
        if (!t) throw retryable(); // changed since we read it → reload and recompute

        const ref = { task: taskRef(task, project) };
        const refs = { projectId: task.projectId, taskId: task._id };
        const acts = [];
        // FR-ORD-09: only CROSS-column moves are history; reordering within a column isn't.
        if (!sameColumn) {
          acts.push(
            activity(ctx, 'task.moved', { ...ref, from: colRef(fromCol), to: colRef(toCol) }, refs),
          );
        }
        if (intoDone) acts.push(activity(ctx, 'task.completed', ref, refs)); // Day 18: + sprint deltas
        if (outOfDone) acts.push(activity(ctx, 'task.reopened', ref, refs));
        if (acts.length) await Activity.insertMany(acts, { session });
        return t;
      });

      return {
        noop: false,
        task: toTaskCard(updated),
        rank,
        fromColumnId: String(task.columnId),
        projectId: task.projectId,
      };
    }),
  );

  if (!result.noop) {
    await publish(ctx, [
      {
        type: 'task.moved',
        projectId: result.projectId,
        task: result.task,
        fromColumnId: result.fromColumnId,
        completed: !!result.task.completedAt,
      },
    ]);
    if (result.rank.length > LIMITS.rankMaxLength) {
      // E12 / FR-ORD-10. "Background": the user doesn't wait for it.
      void rebalanceColumn(ctx, result.projectId, toColumnId).catch((err: unknown) =>
        logger.error({ err }, 'rebalance failed'),
      );
    }
  }
  return { task: result.task, noop: result.noop };
}

/**
 * queries.md §6.4: re-space every rank in a column with short, evenly spaced keys, keeping
 * the current order. Two passes inside one transaction: the unique rank index is checked per
 * statement, so writing the final keys directly could briefly collide with a key another card
 * still holds. First every card gets a temporary unique value, then its final key.
 */
export async function rebalanceColumn(
  ctx: Ctx,
  projectId: Types.ObjectId,
  columnId: Types.ObjectId,
) {
  const ranks = await withTransaction(async (session) => {
    const tasks = await Task.find({ workspaceId: ctx.workspaceId, projectId, columnId })
      .sort({ rank: 1, _id: 1 })
      .select('_id')
      .session(session)
      .lean();
    if (tasks.length === 0) return {};
    const keys = generateNKeysBetween(null, null, tasks.length);
    await tenantBulkWrite(
      ctx,
      Task,
      tasks.map((t) => ({
        updateOne: { filter: { _id: t._id }, update: { $set: { rank: `~${String(t._id)}` } } }, // temp
      })),
      { session },
    );
    await tenantBulkWrite(
      ctx,
      Task,
      tasks.map((t, i) => ({
        updateOne: {
          filter: { _id: t._id },
          update: { $set: { rank: keys[i]! }, $inc: { version: 1 } },
        },
      })),
      { session },
    );
    return Object.fromEntries(tasks.map((t, i) => [String(t._id), keys[i]!]));
  });
  if (Object.keys(ranks).length > 0) {
    await publish(ctx, [
      { type: 'column.rebalanced', projectId, columnId: String(columnId), ranks },
    ]);
  }
  return ranks;
}
