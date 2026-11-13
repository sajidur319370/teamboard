import { z } from 'zod';
import type { ActivityAction } from '../constants';
import { objectIdSchema } from './common';

export const commentBodySchema = z.object({
  body: z.string().trim().min(1, 'Write something').max(5000, 'At most 5,000 characters'),
});
export type CommentBodyInput = z.infer<typeof commentBodySchema>;
export const commentIdParams = z.object({ commentId: objectIdSchema });

/** Opaque, base64url (lib/cursor.ts). An empty value means "first page". */
export const cursorSchema = z
  .string()
  .max(200)
  .regex(/^[A-Za-z0-9_-]*$/, 'Invalid cursor')
  .optional();
export const limitSchema = (fallback: number) =>
  z.coerce.number().int().min(1).max(100).default(fallback);

/** FR-CMT-04: oldest first, 50 per page. */
export const commentsQuery = z.object({ cursor: cursorSchema, limit: limitSchema(50) });

/** FR-ACT-07: the feed's filter chips. Everything else (project, column, workspace) is "All". */
export const ACTION_GROUPS = {
  tasks: [
    'task.created',
    'task.updated',
    'task.assigned',
    'task.unassigned',
    'task.moved',
    'task.completed',
    'task.reopened',
    'task.deleted',
  ],
  comments: ['comment.created', 'comment.deleted'],
  members: [
    'member.joined',
    'member.role_changed',
    'member.removed',
    'member.left',
    'ownership.transferred',
    'invite.created',
    'invite.revoked',
  ],
  sprints: [
    'sprint.created',
    'sprint.started',
    'sprint.completed',
    'sprint.deleted',
    'task.added_to_sprint',
    'task.removed_from_sprint',
  ],
} as const satisfies Record<string, readonly ActivityAction[]>;
export type ActionGroup = keyof typeof ACTION_GROUPS;
export const ACTION_GROUP_NAMES = Object.keys(ACTION_GROUPS) as [ActionGroup, ...ActionGroup[]];

/** FR-ACT-06: newest first, 30 per page. taskId wins over projectId (it's narrower). */
export const activityQuery = z.object({
  cursor: cursorSchema,
  limit: limitSchema(30),
  projectId: objectIdSchema.optional(),
  taskId: objectIdSchema.optional(),
  actorId: objectIdSchema.optional(),
  group: z.enum(ACTION_GROUP_NAMES).optional(),
});
export type ActivityQuery = z.infer<typeof activityQuery>;
