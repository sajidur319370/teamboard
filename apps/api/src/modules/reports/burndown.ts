import type { ClientSession, Types } from 'mongoose';
import { BURNDOWN_ACTIONS, type BurndownPoint } from '@teamboard/shared';
import { Activity } from '../../db/models';
import { calendarDays, round1, weekday } from '../../lib/dates';
import type { Ctx } from '../../types/ctx';

/** One row per day that HAD events, with running totals (what the pipeline returns). */
export interface CumRow {
  day: string;
  cumScopeTasks: number;
  cumScopePoints: number;
  cumDoneTasks: number;
  cumDonePoints: number;
}

export interface SprintLike {
  _id: Types.ObjectId | string;
  state: string;
  startDate: string;
  endDate: string;
  startedAt?: Date | null;
  scopeSnapshot?: {
    totalTasks: number;
    totalPoints: number;
    doneTasks: number;
    donePoints: number;
  } | null;
}

/**
 * queries.md §12.1: MongoDB sums the deltas per day and keeps a running total.
 * Days are STRINGS in the workspace timezone (23:30 UTC is already tomorrow in Dhaka).
 */
export function burndownRows(
  ctx: Ctx,
  sprint: { _id: Types.ObjectId; startedAt?: Date | null },
  session?: ClientSession,
) {
  return Activity.aggregate<CumRow>([
    {
      $match: {
        workspaceId: ctx.workspaceId,
        sprintId: sprint._id,
        action: { $in: BURNDOWN_ACTIONS },
        createdAt: { $gte: sprint.startedAt ?? new Date(0) },
      },
    },
    {
      $group: {
        _id: { $dateToString: { date: '$createdAt', format: '%Y-%m-%d', timezone: ctx.tz } },
        scopeTasks: { $sum: { $ifNull: ['$metadata.scopeDelta.count', 0] } },
        scopePoints: { $sum: { $ifNull: ['$metadata.scopeDelta.points', 0] } },
        doneTasks: { $sum: { $ifNull: ['$metadata.doneDelta.count', 0] } },
        donePoints: { $sum: { $ifNull: ['$metadata.doneDelta.points', 0] } },
      },
    },
    {
      $setWindowFields: {
        sortBy: { _id: 1 },
        output: {
          cumScopeTasks: { $sum: '$scopeTasks', window: { documents: ['unbounded', 'current'] } },
          cumScopePoints: { $sum: '$scopePoints', window: { documents: ['unbounded', 'current'] } },
          cumDoneTasks: { $sum: '$doneTasks', window: { documents: ['unbounded', 'current'] } },
          cumDonePoints: { $sum: '$donePoints', window: { documents: ['unbounded', 'current'] } },
        },
      },
    },
    {
      $project: {
        _id: 0,
        day: '$_id',
        cumScopeTasks: 1,
        cumScopePoints: 1,
        cumDoneTasks: 1,
        cumDonePoints: 1,
      },
    },
    { $sort: { day: 1 } },
  ]).session(session ?? null);
}

const NO_EVENTS: Omit<CumRow, 'day'> = {
  cumScopeTasks: 0,
  cumScopePoints: 0,
  cumDoneTasks: 0,
  cumDonePoints: 0,
};

/**
 * queries.md §12.2, a pure function: fill the calendar (days without events carry the
 * previous totals), and add the ideal line, which only moves on WORKING days.
 */
export function burndownSeries(
  sprint: SprintLike,
  rows: CumRow[],
  workingDays: number[],
  today: string,
): BurndownPoint[] {
  const base = sprint.scopeSnapshot;
  if (!base) return []; // planned: nothing to draw yet
  // An overdue active sprint extends to today (FR-SPR-09); otherwise stop at the end date.
  const lastDay = today > sprint.endDate && sprint.state === 'active' ? today : sprint.endDate;
  const days = calendarDays(sprint.startDate, lastDay);
  const working = new Set(
    days.filter((d) => d <= sprint.endDate && workingDays.includes(weekday(d))),
  );
  const committedTasks = base.totalTasks - base.doneTasks; // remaining at the start
  const committedPoints = base.totalPoints - base.donePoints;

  let i = 0;
  let cum = NO_EVENTS;
  let workedSoFar = 0;

  return days.map((day) => {
    while (i < rows.length && rows[i]!.day <= day) cum = rows[i++]!; // carry forward
    if (working.has(day)) workedSoFar++;
    const f = working.size ? 1 - workedSoFar / working.size : 0; // flat on non-working days

    const scopeTasks = base.totalTasks + cum.cumScopeTasks;
    const scopePoints = base.totalPoints + cum.cumScopePoints;
    const future = day > today;
    const planned = day <= sprint.endDate;
    return {
      day,
      scopeTasks,
      scopePoints,
      remainingTasks: future ? null : scopeTasks - (base.doneTasks + cum.cumDoneTasks),
      remainingPoints: future ? null : scopePoints - (base.donePoints + cum.cumDonePoints),
      idealTasks: planned ? round1(committedTasks * f) : null,
      idealPoints: planned ? round1(committedPoints * f) : null,
    };
  });
}
