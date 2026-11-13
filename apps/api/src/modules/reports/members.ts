import type { ClientSession, Types } from 'mongoose';
import { isPaletteColor, type MemberStatDto } from '@teamboard/shared';
import { Task } from '../../db/models';
import type { Ctx } from '../../types/ctx';

type Row = Omit<MemberStatDto, 'userId' | 'avatarColor'> & {
  userId: Types.ObjectId | null;
  avatarColor?: string | null;
};

/**
 * queries.md §13 / FR-RPT-05: tasks (and points) completed in the sprint, per assignee.
 * A task with two assignees counts for both; no assignee → "Unassigned" (last).
 * Former members are tagged, not hidden.
 */
export async function memberStats(
  ctx: Ctx,
  sprint: { _id: Types.ObjectId; projectId: Types.ObjectId },
  session?: ClientSession,
): Promise<MemberStatDto[]> {
  const rows = await Task.aggregate<Row>([
    {
      $match: {
        workspaceId: ctx.workspaceId,
        projectId: sprint.projectId,
        sprintId: sprint._id,
        completedAt: { $ne: null },
      },
    },
    { $project: { assigneeIds: 1, points: { $ifNull: ['$storyPoints', 0] } } },
    { $unwind: { path: '$assigneeIds', preserveNullAndEmptyArrays: true } },
    {
      $group: {
        _id: { $ifNull: ['$assigneeIds', null] },
        tasks: { $sum: 1 },
        points: { $sum: '$points' },
      },
    },
    {
      $lookup: {
        from: 'users',
        localField: '_id',
        foreignField: '_id',
        pipeline: [{ $project: { name: 1, avatarColor: 1 } }],
        as: 'user',
      },
    },
    {
      // Still a member? The join itself is tenant-scoped (workspaceId in the sub-pipeline).
      $lookup: {
        from: 'memberships',
        let: { uid: '$_id' },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [{ $eq: ['$userId', '$$uid'] }, { $eq: ['$workspaceId', ctx.workspaceId] }],
              },
            },
          },
          { $project: { _id: 1 } },
        ],
        as: 'membership',
      },
    },
    {
      $project: {
        _id: 0,
        userId: '$_id',
        name: {
          $cond: [
            { $eq: ['$_id', null] },
            'Unassigned',
            { $ifNull: [{ $first: '$user.name' }, 'Former user'] },
          ],
        },
        avatarColor: { $first: '$user.avatarColor' },
        tasks: 1,
        points: 1,
        isFormer: { $and: [{ $ne: ['$_id', null] }, { $eq: [{ $size: '$membership' }, 0] }] },
      },
    },
    { $sort: { points: -1, tasks: -1, name: 1 } },
  ]).session(session ?? null);

  const out = rows.map((r) => ({
    userId: r.userId ? String(r.userId) : null,
    name: r.name,
    avatarColor: r.avatarColor && isPaletteColor(r.avatarColor) ? r.avatarColor : null,
    tasks: r.tasks,
    points: r.points,
    isFormer: r.isFormer,
  }));
  // "Unassigned" last, whatever its numbers (C3)
  return [...out.filter((m) => m.userId), ...out.filter((m) => !m.userId)];
}
