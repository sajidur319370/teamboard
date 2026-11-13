import { Router } from 'express';
import {
  notificationIdParams,
  notificationsQuery,
  rooms,
  type NotificationDto,
  type Page,
} from '@teamboard/shared';
import { Notification } from '../db/models';
import { afterCursor, pageOf } from '../lib/cursor';
import { notFound } from '../lib/errors';
import { oid } from '../lib/ids';
import { authorize } from '../middleware/authorize';
import { validate, valid } from '../middleware/validate';
import { getIO } from '../realtime/socket';
import type { Ctx } from '../types/ctx';
import { toNotificationDtos } from './notify';

/**
 * /api/w/:slug/notifications: MY notifications in THIS workspace (queries.md §15.2).
 * userId is in every filter: someone else's notification doesn't exist for you (404).
 */
export const notificationsRouter = Router({ mergeParams: true });

const mine = (ctx: Ctx) => ({ userId: ctx.userId, workspaceId: ctx.workspaceId });
const unreadCount = (ctx: Ctx) => Notification.countDocuments({ ...mine(ctx), readAt: null });

/** The bell in my OTHER tabs follows a read in this one. */
async function syncOtherTabs(ctx: Ctx) {
  const io = getIO();
  if (!io) return;
  io.to(rooms.user(String(ctx.userId))).emit('notification:read', {
    workspaceId: String(ctx.workspaceId),
    unreadCount: await unreadCount(ctx),
  });
}

const listReq = { query: notificationsQuery };
notificationsRouter.get('/', authorize('notification:own'), validate(listReq), async (req, res) => {
  const { cursor, limit, unread } = valid(req, listReq).query;
  const rows = await Notification.find({
    ...mine(req.ctx),
    ...(unread === 'true' && { readAt: null }),
    ...(cursor && afterCursor(cursor, 'desc')),
  })
    .sort({ createdAt: -1, _id: -1 })
    .limit(limit + 1)
    .lean();
  const { items, nextCursor } = pageOf(rows, limit);
  const page: Page<NotificationDto> = { items: await toNotificationDtos(items), nextCursor };
  res.json(page);
});

// Static paths BEFORE /:notificationId/...
notificationsRouter.get('/unread-count', authorize('notification:own'), async (req, res) => {
  res.json({ count: await unreadCount(req.ctx) });
});

notificationsRouter.post('/read-all', authorize('notification:own'), async (req, res) => {
  const r = await Notification.updateMany(
    { ...mine(req.ctx), readAt: null },
    { $set: { readAt: req.ctx.now() } },
  );
  if (r.modifiedCount > 0) await syncOtherTabs(req.ctx);
  res.status(204).end();
});

const readReq = { params: notificationIdParams };
notificationsRouter.post(
  '/:notificationId/read',
  authorize('notification:own'),
  validate(readReq),
  async (req, res) => {
    const _id = oid(valid(req, readReq).params.notificationId);
    // readAt: null in the filter keeps the FIRST read time; a second click is a no-op.
    const r = await Notification.updateOne(
      { _id, ...mine(req.ctx), readAt: null },
      { $set: { readAt: req.ctx.now() } },
    );
    if (r.matchedCount === 0 && !(await Notification.exists({ _id, ...mine(req.ctx) }))) {
      throw notFound(); // not mine (or gone): same answer either way
    }
    if (r.modifiedCount > 0) await syncOtherTabs(req.ctx);
    res.status(204).end();
  },
);
