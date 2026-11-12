import type { Types } from 'mongoose';
import { Membership } from '../../db/models';
import { badRequest } from '../../lib/errors';
import type { Ctx } from '../../types/ctx';

/** Snapshot refs stored in activity metadata, so history survives renames and deletes. */
export const taskRef = (t: { number: number; title: string }, p: { key: string }) => ({
  number: t.number,
  title: t.title,
  key: p.key,
});
export const colRef = (c: { _id: Types.ObjectId; name: string }) => ({
  columnId: String(c._id),
  name: c.name,
});

/**
 * queries.md §8.2: every NEWLY added assignee must be a current member with role ≥ member
 * (BR-10: no viewers). Callers pass only the new ones, so a former member who is already
 * assigned doesn't block editing the task (FR-TSK-10).
 */
export async function assertAssignees(ctx: Ctx, ids: Types.ObjectId[]) {
  if (ids.length === 0) return;
  const n = await Membership.countDocuments({
    workspaceId: ctx.workspaceId,
    userId: { $in: ids },
    role: { $in: ['owner', 'admin', 'member'] },
  });
  if (n !== new Set(ids.map(String)).size) {
    throw badRequest(
      'INVALID_ASSIGNEE',
      'Assignees must be members of this workspace with a role above Viewer.',
    );
  }
}

/** Every label must belong to the task's project (I12). */
export function assertLabels(
  project: { labels: { _id: Types.ObjectId }[] },
  ids: Types.ObjectId[],
) {
  const known = new Set(project.labels.map((l) => String(l._id)));
  if (ids.some((id) => !known.has(String(id)))) {
    throw badRequest('INVALID_LABEL', 'That label is not part of this project.');
  }
}

/** Same members regardless of order (assignee and label lists are sets). */
export const sameIdSet = (a: Types.ObjectId[], b: Types.ObjectId[]) => {
  const sa = new Set(a.map(String));
  return sa.size === new Set(b.map(String)).size && b.every((x) => sa.has(String(x)));
};
