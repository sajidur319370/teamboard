import type { Types } from 'mongoose';
import {
  rooms,
  type NotificationData,
  type NotificationDto,
  type NotificationType,
  type PersonRef,
} from '@teamboard/shared';
import { Membership, Notification } from '../db/models';
import { oid } from '../lib/ids';
import { people } from '../lib/people';
import { getIO } from '../realtime/socket';
import type { Ctx } from '../types/ctx';

/** Viewers can't be assigned or comment, so they only get these (FR-NTF-03). */
const VIEWER_TYPES = new Set<NotificationType>(['member.role_changed', 'ownership.transferred']);

export interface NotifyItem {
  userId: string;
  type: NotificationType;
  data: NotificationData;
  projectId?: Types.ObjectId | null;
  taskId?: Types.ObjectId | null;
  sprintId?: Types.ObjectId | null;
}

type NotificationLean = {
  _id: Types.ObjectId;
  type: string;
  actorId: Types.ObjectId;
  projectId?: Types.ObjectId | null;
  taskId?: Types.ObjectId | null;
  data?: unknown;
  readAt?: Date | null;
  createdAt: Date;
};

export const toNotificationDto = (n: NotificationLean, actor: PersonRef): NotificationDto => ({
  id: String(n._id),
  type: n.type as NotificationType,
  actor,
  projectId: n.projectId ? String(n.projectId) : null,
  taskId: n.taskId ? String(n.taskId) : null,
  data: (n.data ?? {}) as NotificationData,
  readAt: n.readAt?.toISOString() ?? null,
  createdAt: n.createdAt.toISOString(),
});

/** A page of notifications with their actors hydrated in ONE query. */
export async function toNotificationDtos(rows: NotificationLean[]) {
  const actors = await people(rows.map((n) => n.actorId));
  return rows.map((n) => toNotificationDto(n, actors.get(String(n.actorId))!));
}

/** Unread counts for several recipients in ONE aggregation. */
export async function unreadCounts(ctx: Ctx, userIds: Types.ObjectId[]) {
  const rows = await Notification.aggregate<{ _id: Types.ObjectId; n: number }>([
    { $match: { workspaceId: ctx.workspaceId, userId: { $in: userIds }, readAt: null } },
    { $group: { _id: '$userId', n: { $sum: 1 } } },
  ]);
  return new Map(rows.map((r) => [String(r._id), r.n]));
}

/**
 * Stores and pushes notifications for ONE action. Runs after the commit (from publish()).
 * Rules: never the actor (FR-NTF-02 / BR-13); one per person, the FIRST matching rule wins
 * (FR-NTF-10, so callers list rules by priority); only current members, and Viewers only
 * for role/ownership news (FR-NTF-03, E11).
 */
export async function notify(ctx: Ctx, items: NotifyItem[]): Promise<void> {
  const byUser = new Map<string, NotifyItem>();
  for (const it of items) {
    if (it.userId !== String(ctx.userId) && !byUser.has(it.userId)) byUser.set(it.userId, it);
  }
  if (byUser.size === 0) return;

  const members = await Membership.find({
    workspaceId: ctx.workspaceId,
    userId: { $in: [...byUser.keys()].map(oid) },
  })
    .select('userId role')
    .lean();
  const allowed = members
    .map((m) => ({ role: m.role, it: byUser.get(String(m.userId))! }))
    .filter(({ role, it }) => role !== 'viewer' || VIEWER_TYPES.has(it.type))
    .map(({ it }) => it);
  if (allowed.length === 0) return;

  const docs = await Notification.insertMany(
    allowed.map((it) => ({
      workspaceId: ctx.workspaceId,
      userId: oid(it.userId),
      type: it.type,
      actorId: ctx.userId,
      projectId: it.projectId ?? null,
      taskId: it.taskId ?? null,
      sprintId: it.sprintId ?? null,
      data: it.data,
      createdAt: ctx.now(), // the TTL counts from here
    })),
  );

  const io = getIO();
  if (!io) return;
  const counts = await unreadCounts(
    ctx,
    docs.map((d) => d.userId),
  );
  const actor = (await people([ctx.userId])).get(String(ctx.userId))!;
  for (const d of docs) {
    io.to(rooms.user(String(d.userId))).emit('notification:new', {
      workspaceId: String(ctx.workspaceId),
      notification: toNotificationDto(d.toObject(), actor),
      unreadCount: counts.get(String(d.userId)) ?? 1,
    }); // FR-NTF-05
  }
}
