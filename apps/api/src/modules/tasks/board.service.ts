import { isPaletteColor, type BoardResponse } from '@teamboard/shared';
import { CARD_FIELDS, Task, User } from '../../db/models';
import { notFound } from '../../lib/errors';
import type { Ctx } from '../../types/ctx';
import { listMembers } from '../members/member.service';
import { findProject } from '../projects/project.helpers';
import { toProjectDto } from '../projects/project.dto';
import { toTaskCard } from './task.dto';

const subDays = (d: Date, n: number) => new Date(d.getTime() - n * 86_400_000);
export const RECENT_DONE_DAYS = 14; // FR-BRD-11

/**
 * GET /projects/:key/board?sprint=active|backlog|all|<sprintId> (queries.md §7).
 * Everything the board needs in ONE request (FR-BRD-10): 4–5 indexed queries.
 */
export async function loadBoard(
  ctx: Ctx,
  key: string,
  sprintParam: string,
): Promise<BoardResponse> {
  const project = await findProject(ctx, key);
  const activeSprint = null; // Day 18: Sprint.findOne({ workspaceId, projectId, state: 'active' })

  const filter: Record<string, unknown> = { workspaceId: ctx.workspaceId, projectId: project._id };
  // FR-BRD-07: "active" falls back to "all open tasks" when no sprint is running.
  const view = sprintParam === 'active' && !activeSprint ? 'all' : sprintParam;

  switch (view) {
    case 'backlog':
      filter.sprintId = null;
      break;
    case 'all':
      // Open tasks + tasks completed in the last 14 days. $not/$lt matches BOTH null and
      // recent dates in one predicate.
      filter.completedAt = { $not: { $lt: subDays(ctx.now(), RECENT_DONE_DAYS) } };
      break;
    default:
      throw notFound(); // Day 18: 'active' with a running sprint, and specific sprint ids
  }

  const tasks = await Task.find(filter).select(CARD_FIELDS).sort({ columnId: 1, rank: 1 }).lean();

  // A task created at the exact moment its column was deleted would point at a column that
  // no longer exists. Show it in the first column instead of losing it.
  const columnIds = new Set(project.columns.map((c) => String(c._id)));
  const firstColumn = [...project.columns].sort((a, b) => a.position - b.position)[0]!;
  const cards = tasks.map((t) => {
    const card = toTaskCard(t);
    return columnIds.has(card.columnId) ? card : { ...card, columnId: String(firstColumn._id) };
  });

  const members = await listMembers(ctx);
  const memberIds = new Set(members.map((m) => m.userId));
  const formerIds = [...new Set(cards.flatMap((t) => t.assigneeIds))].filter(
    (id) => !memberIds.has(id),
  );
  const former = formerIds.length
    ? await User.find({ _id: { $in: formerIds } })
        .select('name avatarColor')
        .lean()
    : [];

  return {
    project: toProjectDto(project),
    view: view as BoardResponse['view'],
    activeSprint,
    tasks: cards,
    members: members.map(({ userId, name, avatarColor, role }) => ({
      userId,
      name,
      avatarColor,
      role,
    })),
    formerMembers: former.map((u) => ({
      userId: String(u._id),
      name: u.name,
      avatarColor: isPaletteColor(u.avatarColor) ? u.avatarColor : 'gray',
    })),
  };
}
