import type { ClientSession, Types } from 'mongoose';
import type { SprintSummaryReportDto } from '@teamboard/shared';
import { Activity, Task } from '../../db/models';
import { round1 } from '../../lib/dates';
import type { Ctx } from '../../types/ctx';

type Totals = { tasks: number; points: number };
const ZERO: Totals = { tasks: 0, points: 0 };
const pct = (done: number, scope: number) => (scope > 0 ? round1((done / scope) * 100) : 0);

/**
 * queries.md §14.1 / FR-RPT-06. Sequential, not Promise.all: inside the completion
 * transaction a session runs one operation at a time.
 */
export async function sprintSummary(
  ctx: Ctx,
  sprint: {
    _id: Types.ObjectId;
    projectId: Types.ObjectId;
    startedAt?: Date | null;
    scopeSnapshot?: { totalTasks: number; totalPoints: number } | null;
  },
  session?: ClientSession,
): Promise<SprintSummaryReportDto> {
  const scopeChanges = await Activity.aggregate<Totals & { _id: string }>([
    {
      $match: {
        workspaceId: ctx.workspaceId,
        sprintId: sprint._id,
        action: { $in: ['task.added_to_sprint', 'task.removed_from_sprint'] },
        createdAt: { $gte: sprint.startedAt ?? new Date(0) },
      },
    },
    {
      $group: {
        _id: '$action',
        tasks: { $sum: { $abs: '$metadata.scopeDelta.count' } },
        points: { $sum: { $abs: '$metadata.scopeDelta.points' } },
      },
    },
  ]).session(session ?? null);

  const inSprint = (completed: boolean) =>
    Task.aggregate<Totals>([
      {
        $match: {
          workspaceId: ctx.workspaceId,
          projectId: sprint.projectId,
          sprintId: sprint._id,
          completedAt: completed ? { $ne: null } : null,
        },
      },
      {
        $group: {
          _id: null,
          tasks: { $sum: 1 },
          points: { $sum: { $ifNull: ['$storyPoints', 0] } },
        },
      },
    ]).session(session ?? null);
  const [completed = ZERO] = await inSprint(true);
  const [unfinished = ZERO] = await inSprint(false);

  const added = scopeChanges.find((r) => r._id === 'task.added_to_sprint') ?? ZERO;
  const removed = scopeChanges.find((r) => r._id === 'task.removed_from_sprint') ?? ZERO;
  const committed = {
    tasks: sprint.scopeSnapshot?.totalTasks ?? 0,
    points: sprint.scopeSnapshot?.totalPoints ?? 0,
  };
  return {
    committedTasks: committed.tasks,
    committedPoints: committed.points,
    addedTasks: added.tasks,
    addedPoints: added.points,
    removedTasks: removed.tasks,
    removedPoints: removed.points,
    completedTasks: completed.tasks,
    completedPoints: completed.points,
    carriedOverTasks: unfinished.tasks,
    carriedOverPoints: unfinished.points,
    completionPct: {
      tasks: pct(completed.tasks, committed.tasks + added.tasks - removed.tasks),
      points: pct(completed.points, committed.points + added.points - removed.points),
    },
  };
}
