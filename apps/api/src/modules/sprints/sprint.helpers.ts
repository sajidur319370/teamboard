import type { ClientSession, Types } from 'mongoose';
import type { BurndownDelta, SprintState, TaskRef } from '@teamboard/shared';
import { Sprint } from '../../db/models';
import { badRequest, conflict } from '../../lib/errors';
import { activity, type ActivityRefs } from '../../events/activity';
import type { Ctx } from '../../types/ctx';

/** What the delta rules need from a task. */
export type TaskForDelta = {
  _id: Types.ObjectId;
  number: number;
  title: string;
  storyPoints?: number | null;
  completedAt?: Date | null;
};
type SprintRef = { _id: Types.ObjectId; name: string };

const pts = (t: { storyPoints?: number | null }) => t.storyPoints ?? 0;
const ZERO = { count: 0, points: 0 };
const ALL_STATES: SprintState[] = ['planned', 'active', 'completed'];

/**
 * The "touch the sprint" lock (queries.md §10.1, D10). MongoDB transactions catch
 * write-write conflicts, not read-write ones: a sprint start READS its tasks while an add
 * or a delete WRITES a task, so either could slip past the snapshot. Making every such
 * operation also WRITE the sprint turns that race into a write conflict, and the driver
 * retries the loser, which then sees the winner's result.
 *
 * Returns the sprint as it is inside this transaction (null if it doesn't exist).
 */
export async function lockSprint(
  ctx: Ctx,
  sprintId: Types.ObjectId,
  session: ClientSession,
  allowed: SprintState[] = ALL_STATES,
) {
  return Sprint.findOneAndUpdate(
    { _id: sprintId, workspaceId: ctx.workspaceId, state: { $in: allowed } },
    { $inc: { lock: 1 } },
    {
      returnDocument: 'after',
      session,
      projection: { name: 1, number: 1, state: 1, projectId: 1 },
    },
  ).lean();
}

/** lockSprint() that must succeed: the sprint exists and is in one of `allowed`. */
export async function touchSprint(
  ctx: Ctx,
  sprintId: Types.ObjectId,
  allowed: SprintState[],
  session: ClientSession,
) {
  const s = await lockSprint(ctx, sprintId, session, allowed);
  if (!s) {
    throw conflict('INVALID_SPRINT_STATE', 'That sprint cannot be changed in its current state.');
  }
  return s;
}

/**
 * The sprint a task is in, locked, but only if it is ACTIVE: the only state whose
 * burndown is being recorded. Planned and completed sprints get no deltas.
 */
export async function activeSprintOf(
  ctx: Ctx,
  sprintId: Types.ObjectId | null | undefined,
  session: ClientSession,
) {
  if (!sprintId) return null;
  const s = await lockSprint(ctx, sprintId, session);
  return s?.state === 'active' ? s : null;
}

/** task.added_to_sprint / task.removed_from_sprint with deltas (data-model.md §12). */
export function sprintScopeActivity(
  ctx: Ctx,
  t: TaskForDelta,
  projectKey: string,
  projectId: Types.ObjectId,
  sprint: SprintRef,
  sign: 1 | -1,
) {
  const d = { count: sign, points: sign * pts(t) };
  const deltas: BurndownDelta = { scopeDelta: d, doneDelta: t.completedAt ? d : ZERO };
  return activity(
    ctx,
    sign === 1 ? 'task.added_to_sprint' : 'task.removed_from_sprint',
    {
      task: { number: t.number, title: t.title, key: projectKey },
      sprint: { name: sprint.name },
      ...deltas,
    },
    { projectId, taskId: t._id, sprintId: sprint._id },
  );
}

/** task.completed (+1) / task.reopened (−1): only done work changes. */
export const completionDeltas = (
  t: { storyPoints?: number | null },
  intoDone: boolean,
): BurndownDelta => {
  const s = intoDone ? 1 : -1;
  return { scopeDelta: ZERO, doneDelta: { count: s, points: s * pts(t) } };
};

/** D6: a story-point change inside an active sprint is ONE task.updated event with deltas. */
export function pointsDeltas(
  oldPts: number | null | undefined,
  newPts: number | null | undefined,
  isDone: boolean,
): BurndownDelta {
  const diff = (newPts ?? 0) - (oldPts ?? 0);
  return {
    scopeDelta: { count: 0, points: diff },
    doneDelta: { count: 0, points: isDone ? diff : 0 },
  };
}

/**
 * task.completed / task.reopened, with sprintId + deltas when the task is in the ACTIVE
 * sprint. Without a sprintId an event never touches a burndown (data-model.md §12).
 */
export function completionActivity(
  ctx: Ctx,
  t: { storyPoints?: number | null },
  task: TaskRef,
  refs: ActivityRefs,
  intoDone: boolean,
  activeSprint: { _id: Types.ObjectId } | null,
) {
  return activity(
    ctx,
    intoDone ? 'task.completed' : 'task.reopened',
    { task, ...(activeSprint && completionDeltas(t, intoDone)) },
    { ...refs, sprintId: activeSprint?._id ?? null },
  );
}

/** A task can be created in / added to a planned or active sprint of ITS project. */
export async function assertSprintForTask(
  ctx: Ctx,
  projectId: Types.ObjectId,
  sprintId: Types.ObjectId,
) {
  const s = await Sprint.findOne({
    _id: sprintId,
    workspaceId: ctx.workspaceId,
    projectId,
    state: { $in: ['planned', 'active'] },
  }).lean();
  if (!s) throw badRequest('INVALID_SPRINT', 'Choose a planned or active sprint of this project.');
  return s;
}
