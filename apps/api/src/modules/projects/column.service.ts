import { generateNKeysBetween } from 'fractional-indexing';
import type { ClientSession, Types } from 'mongoose';
import {
  LIMITS,
  type ColumnDto,
  type CreateColumnInput,
  type UpdateColumnInput,
} from '@teamboard/shared';
import { Activity, Project, Task } from '../../db/models';
import { withTransaction } from '../../db/transaction';
import { tenantBulkWrite } from '../../db/tenantBulkWrite';
import { badRequest, conflict, notFound } from '../../lib/errors';
import { activity } from '../../events/activity';
import { publish } from '../../events/publish';
import type { Ctx } from '../../types/ctx';
import {
  assertBoardInvariant,
  assertWritable,
  boardChanged,
  findProject,
  sameName,
  unchangedSince,
  type ProjectLean,
} from './project.helpers';
import { sortedColumns } from './project.dto';

type Kind = 'created' | 'updated' | 'deleted' | 'reordered';

/** Reload the columns after a commit, publish them, and return them to the caller. */
async function columnsChanged(
  ctx: Ctx,
  projectId: Types.ObjectId,
  kind: Kind,
  movedTaskIds?: string[],
): Promise<ColumnDto[]> {
  const p = await Project.findOne({ _id: projectId, workspaceId: ctx.workspaceId })
    .select('columns')
    .lean();
  const columns = sortedColumns(p?.columns ?? []);
  await publish(ctx, [
    { type: 'columns.changed', kind, projectId, columns, ...(movedTaskIds && { movedTaskIds }) },
  ]);
  return columns;
}

/**
 * FR-BRD-06: tasks crossing into / out of a `done` column get completedAt set / cleared,
 * plus one task.completed / task.reopened activity each, so reports stay correct.
 * Day 18 adds sprintId + burndown deltas when the task is in the active sprint.
 */
async function writeCompletionChanges(
  ctx: Ctx,
  p: ProjectLean,
  tasks: { _id: Types.ObjectId; number: number; title: string }[],
  intoDone: boolean,
  session: ClientSession,
) {
  if (tasks.length === 0) return;
  await Activity.insertMany(
    tasks.map((t) =>
      activity(
        ctx,
        intoDone ? 'task.completed' : 'task.reopened',
        { task: { number: t.number, title: t.title, key: p.key } },
        { projectId: p._id, taskId: t._id },
      ),
    ),
    { session },
  );
}

export async function addColumn(ctx: Ctx, key: string, input: CreateColumnInput) {
  const p = await findProject(ctx, key);
  assertWritable(p);
  if (p.columns.length >= LIMITS.columnsPerProject) {
    throw conflict('COLUMN_LIMIT', `A board can have at most ${LIMITS.columnsPerProject} columns.`);
  }
  if (p.columns.some((c) => sameName(c.name, input.name))) {
    throw conflict('COLUMN_NAME_TAKEN', 'A column with this name already exists.');
  }

  await withTransaction(async (session) => {
    const res = await Project.updateOne(
      unchangedSince(ctx, p), // CAS: nobody added/renamed/reordered meanwhile
      { $push: { columns: { ...input, position: p.columns.length } } },
      { session },
    );
    if (res.modifiedCount === 0) throw boardChanged();
    await Activity.create(
      [
        activity(
          ctx,
          'column.created',
          { name: input.name, category: input.category },
          { projectId: p._id },
        ),
      ],
      { session },
    );
  });
  return columnsChanged(ctx, p._id, 'created');
}

/** FR-BRD-03: the body must be an exact permutation of the current column ids. */
export async function reorderColumns(ctx: Ctx, key: string, columnIds: string[]) {
  const p = await findProject(ctx, key);
  assertWritable(p);
  const current = p.columns.map((c) => String(c._id));
  const isPermutation =
    columnIds.length === current.length &&
    new Set(columnIds).size === current.length &&
    columnIds.every((id) => current.includes(id));
  if (!isPermutation) throw badRequest('INVALID_ORDER', 'Send every column id exactly once.');

  const reordered = columnIds.map((id, i) => ({
    ...p.columns.find((c) => String(c._id) === id)!,
    position: i,
  }));
  await withTransaction(async (session) => {
    const res = await Project.updateOne(
      unchangedSince(ctx, p),
      { $set: { columns: reordered } },
      { session },
    );
    if (res.modifiedCount === 0) throw boardChanged();
    await Activity.create(
      [activity(ctx, 'column.reordered', { order: columnIds }, { projectId: p._id })],
      { session },
    );
  });
  return columnsChanged(ctx, p._id, 'reordered');
}

/** Rename and/or change category (queries.md §5.5). */
export async function updateColumn(
  ctx: Ctx,
  key: string,
  columnId: Types.ObjectId,
  input: UpdateColumnInput,
) {
  const p = await findProject(ctx, key);
  assertWritable(p);
  const col = p.columns.find((c) => c._id.equals(columnId));
  if (!col) throw notFound();

  const rename = input.name !== undefined && input.name !== col.name;
  if (rename && p.columns.some((c) => !c._id.equals(columnId) && sameName(c.name, input.name!))) {
    throw conflict('COLUMN_NAME_TAKEN', 'A column with this name already exists.');
  }
  const oldCategory = col.category;
  const newCategory = input.category ?? oldCategory;
  const recategorize = newCategory !== oldCategory;
  if (!rename && !recategorize) return columnsChanged(ctx, p._id, 'updated');
  if (recategorize) {
    assertBoardInvariant(
      p.columns.map((c) => (c._id.equals(columnId) ? { category: newCategory } : c)),
    );
  }

  await withTransaction(async (session) => {
    // CAS: two admins re-categorizing two different `done` columns at once can't both win,
    // so the board can never end up with zero done columns.
    const res = await Project.updateOne(
      unchangedSince(ctx, p),
      {
        $set: {
          ...(rename && { 'columns.$[c].name': input.name }),
          ...(recategorize && { 'columns.$[c].category': newCategory }),
        },
      },
      { arrayFilters: [{ 'c._id': columnId }], session },
    );
    if (res.modifiedCount === 0) throw boardChanged();
    if (rename) {
      await Activity.create(
        [activity(ctx, 'column.renamed', { from: col.name, to: input.name }, { projectId: p._id })],
        { session },
      );
    }

    const intoDone = newCategory === 'done' && oldCategory !== 'done';
    const outOfDone = oldCategory === 'done' && newCategory !== 'done';
    if (!intoDone && !outOfDone) return;

    const scope = { workspaceId: ctx.workspaceId, projectId: p._id, columnId };
    const affected = await Task.find(scope).select('_id number title').session(session).lean();
    await Task.updateMany(
      scope,
      { $set: { completedAt: intoDone ? ctx.now() : null }, $inc: { version: 1 } },
      { session },
    );
    await writeCompletionChanges(ctx, p, affected, intoDone, session);
  });
  return columnsChanged(ctx, p._id, 'updated');
}

/** FR-BRD-04 / queries.md §5.6: tasks move to the bottom of the target, in their current order. */
export async function deleteColumn(
  ctx: Ctx,
  key: string,
  columnId: Types.ObjectId,
  targetColumnId?: Types.ObjectId,
) {
  const p = await findProject(ctx, key);
  assertWritable(p);
  const source = p.columns.find((c) => c._id.equals(columnId));
  if (!source) throw notFound();
  if (targetColumnId?.equals(columnId)) {
    throw badRequest('INVALID_COLUMN', "Tasks can't move into the column being deleted.");
  }

  const remaining = p.columns
    .filter((c) => !c._id.equals(columnId))
    .sort((a, b) => a.position - b.position)
    .map((c, i) => ({ ...c, position: i }));
  assertBoardInvariant(remaining); // E16: never delete the last done (or last non-done) column

  const target = targetColumnId ? remaining.find((c) => c._id.equals(targetColumnId)) : undefined;
  if (targetColumnId && !target) {
    throw badRequest('INVALID_COLUMN', 'The target column is not on this board.');
  }

  const movedTaskIds = await withTransaction(async (session) => {
    const res = await Project.updateOne(
      unchangedSince(ctx, p),
      { $set: { columns: remaining } },
      { session },
    );
    if (res.modifiedCount === 0) throw boardChanged();

    // Counted INSIDE the transaction, after the CAS, so the answer matches what we delete.
    const tasks = await Task.find({ workspaceId: ctx.workspaceId, projectId: p._id, columnId })
      .sort({ rank: 1, _id: 1 })
      .select('_id number title')
      .session(session)
      .lean();
    if (tasks.length > 0 && !target) {
      throw badRequest('TARGET_REQUIRED', "Choose where to move this column's tasks.");
    }
    if (tasks.length > 0 && target) {
      const last = await Task.findOne({
        workspaceId: ctx.workspaceId,
        projectId: p._id,
        columnId: target._id,
      })
        .sort({ rank: -1 })
        .select('rank')
        .session(session)
        .lean();
      const ranks = generateNKeysBetween(last?.rank ?? null, null, tasks.length); // append in order
      const sourceDone = source.category === 'done';
      const targetDone = target.category === 'done';
      const crosses = sourceDone !== targetDone;

      await tenantBulkWrite(
        ctx,
        Task,
        tasks.map((t, i) => ({
          updateOne: {
            filter: { _id: t._id, projectId: p._id },
            update: {
              $set: {
                columnId: target._id,
                rank: ranks[i]!,
                ...(crosses && { completedAt: targetDone ? ctx.now() : null }),
              },
              $inc: { version: 1 },
            },
          },
        })),
        { session },
      );
      if (crosses) await writeCompletionChanges(ctx, p, tasks, targetDone, session);
    }
    await Activity.create(
      [
        activity(
          ctx,
          'column.deleted',
          { name: source.name, movedTo: target?.name ?? null, movedTasks: tasks.length },
          { projectId: p._id },
        ),
      ],
      { session },
    );
    return tasks.map((t) => String(t._id));
  });
  return columnsChanged(ctx, p._id, 'deleted', movedTaskIds);
}
