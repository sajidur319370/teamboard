import { z } from 'zod';
import { objectIdSchema } from './common';
import { cursorSchema, limitSchema } from './comment';

/** FR-NTF-06: newest first, 20 per page; `unread=true` for the unread-only view. */
export const notificationsQuery = z.object({
  cursor: cursorSchema,
  limit: limitSchema(20),
  unread: z.enum(['true', 'false']).optional(),
});
export const notificationIdParams = z.object({ notificationId: objectIdSchema });
