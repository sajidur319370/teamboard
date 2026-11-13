import { ACTION_GROUPS, type ActivityDto, type ActivityQuery, type Page } from '@teamboard/shared';
import { Activity } from '../../db/models';
import { afterCursor, pageOf } from '../../lib/cursor';
import { oid } from '../../lib/ids';
import { people } from '../../lib/people';
import type { Ctx } from '../../types/ctx';

/**
 * queries.md §11: the task / project / workspace feeds. Newest first, keyset-paginated on
 * (createdAt, _id): O(page) at any depth, and a new activity arriving between two "Load
 * more" clicks can't shift the next page (skip() would repeat a row).
 */
export async function listActivities(ctx: Ctx, q: ActivityQuery): Promise<Page<ActivityDto>> {
  const rows = await Activity.find({
    workspaceId: ctx.workspaceId, // a foreign projectId/taskId just matches nothing
    // The narrowest scope picks its index: {workspaceId, taskId|projectId, createdAt, _id}.
    ...(q.taskId ? { taskId: oid(q.taskId) } : q.projectId && { projectId: oid(q.projectId) }),
    ...(q.actorId && { actorId: oid(q.actorId) }),
    ...(q.group && { action: { $in: ACTION_GROUPS[q.group] } }),
    ...(q.cursor && afterCursor(q.cursor, 'desc')),
  })
    .sort({ createdAt: -1, _id: -1 })
    .limit(q.limit + 1)
    .lean();
  const { items, nextCursor } = pageOf(rows, q.limit);

  const actors = await people(items.map((a) => a.actorId)); // one query per page (no N+1)
  return {
    items: items.map(
      (a) =>
        ({
          id: String(a._id),
          action: a.action,
          actor: actors.get(String(a.actorId))!,
          projectId: a.projectId ? String(a.projectId) : null,
          taskId: a.taskId ? String(a.taskId) : null,
          sprintId: a.sprintId ? String(a.sprintId) : null,
          metadata: a.metadata as object,
          createdAt: a.createdAt.toISOString(),
        }) as ActivityDto, // metadata was typed per action when it was written (activity())
    ),
    nextCursor,
  };
}
