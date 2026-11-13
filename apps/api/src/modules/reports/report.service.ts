import type { ClientSession, Types } from 'mongoose';
import {
  isPaletteColor,
  todayIn,
  type BurndownResponse,
  type MemberStatDto,
  type MembersReportResponse,
  type ReportUnit,
  type SprintSummaryReportDto,
  type SummaryReportResponse,
} from '@teamboard/shared';
import { Sprint, Task, Workspace } from '../../db/models';
import { conflict, notFound } from '../../lib/errors';
import type { Ctx } from '../../types/ctx';
import { burndownRows, burndownSeries, type SprintLike } from './burndown';
import { memberStats } from './members';
import { sprintSummary } from './summary';

type SprintForReport = SprintLike & {
  _id: Types.ObjectId;
  projectId: Types.ObjectId;
};

async function workingDays(ctx: Ctx, session?: ClientSession) {
  const ws = await Workspace.findOne({ _id: ctx.workspaceId })
    .select('settings.workingDays')
    .session(session ?? null)
    .lean();
  return ws?.settings?.workingDays ?? [1, 2, 3, 4, 5];
}

async function burndownOf(ctx: Ctx, sprint: SprintForReport, session?: ClientSession) {
  const rows = await burndownRows(ctx, sprint, session);
  return burndownSeries(sprint, rows, await workingDays(ctx, session), todayIn(ctx.tz, ctx.now()));
}

/**
 * Everything at once, for the frozen copy. Called INSIDE the completion transaction,
 * before unfinished tasks move out, so it describes exactly the sprint that closed.
 * Sequential on purpose: a session runs one operation at a time.
 */
export async function buildSprintReport(
  ctx: Ctx,
  sprint: SprintForReport,
  session?: ClientSession,
) {
  const burndown = await burndownOf(ctx, sprint, session);
  const members = await memberStats(ctx, sprint, session);
  const summary = await sprintSummary(ctx, sprint, session);
  return {
    timezone: ctx.tz,
    summary,
    burndown,
    members,
    generatedAt: ctx.now(),
  };
}

/** A started sprint of this workspace; planned ones have no report yet. */
async function startedSprint(ctx: Ctx, sprintId: Types.ObjectId) {
  const sprint = await Sprint.findOne({ _id: sprintId, workspaceId: ctx.workspaceId }).lean();
  if (!sprint) throw notFound();
  if (sprint.state === 'planned' || !sprint.scopeSnapshot) {
    throw conflict('SPRINT_NOT_STARTED', 'Reports exist once a sprint starts.');
  }
  // Completed sprints answer from the frozen copy (FR-RPT-07): later edits change nothing.
  const frozen = sprint.state === 'completed' && sprint.report ? sprint.report : null;
  return { sprint: sprint as SprintForReport & typeof sprint, frozen };
}

const meta = (ctx: Ctx, frozen: { timezone: string; generatedAt: Date } | null) => ({
  timezone: frozen?.timezone ?? ctx.tz,
  frozenAt: frozen?.generatedAt.toISOString() ?? null,
});

export async function burndownReport(
  ctx: Ctx,
  sprintId: Types.ObjectId,
  unit: ReportUnit | undefined,
): Promise<BurndownResponse> {
  const { sprint, frozen } = await startedSprint(ctx, sprintId);
  const points = frozen
    ? frozen.burndown.map((p) => ({
        day: p.day,
        scopeTasks: p.scopeTasks ?? 0,
        scopePoints: p.scopePoints ?? 0,
        remainingTasks: p.remainingTasks ?? null,
        remainingPoints: p.remainingPoints ?? null,
        idealTasks: p.idealTasks ?? null,
        idealPoints: p.idealPoints ?? null,
      }))
    : await burndownOf(ctx, sprint);
  const unestimated = await Task.countDocuments({
    workspaceId: ctx.workspaceId,
    projectId: sprint.projectId,
    sprintId: sprint._id,
    storyPoints: null,
  });
  // FR-RPT-03: points if any sprint work has an estimate, otherwise count.
  const hasPoints = points.some((p) => p.scopePoints > 0);
  return {
    ...meta(ctx, frozen),
    unit: unit ?? (hasPoints ? 'points' : 'count'),
    points,
    unestimated,
  };
}

export async function membersReport(
  ctx: Ctx,
  sprintId: Types.ObjectId,
): Promise<MembersReportResponse> {
  const { sprint, frozen } = await startedSprint(ctx, sprintId);
  const members: MemberStatDto[] = frozen
    ? frozen.members.map((m) => ({
        userId: m.userId ? String(m.userId) : null,
        name: m.name ?? 'Former user',
        avatarColor: m.avatarColor && isPaletteColor(m.avatarColor) ? m.avatarColor : null,
        tasks: m.tasks ?? 0,
        points: m.points ?? 0,
        isFormer: !!m.isFormer,
      }))
    : await memberStats(ctx, sprint);
  return { ...meta(ctx, frozen), members };
}

export async function summaryReport(
  ctx: Ctx,
  sprintId: Types.ObjectId,
): Promise<SummaryReportResponse> {
  const { sprint, frozen } = await startedSprint(ctx, sprintId);
  const summary = frozen
    ? (frozen.summary as SprintSummaryReportDto)
    : await sprintSummary(ctx, sprint);
  return { ...meta(ctx, frozen), summary };
}
