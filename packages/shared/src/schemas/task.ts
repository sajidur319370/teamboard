import { z } from 'zod';
import { DATE_ONLY, LIMITS, PRIORITIES, STORY_POINTS } from '../constants';
import { objectIdSchema } from './common';
import { keyParams } from './project';

/** YYYY-MM-DD, a real calendar date, year 2000–2100 (requirement §21). */
export const dueDateSchema = z
  .string()
  .regex(DATE_ONLY, 'Use YYYY-MM-DD')
  .refine((s) => {
    const d = new Date(`${s}T00:00:00Z`);
    const y = d.getUTCFullYear();
    return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(s) && y >= 2000 && y <= 2100;
  }, 'Invalid date');

/** Typed as the literal union 0 | 1 | 2 | 3 | 5 | 8 | 13 | 21, not just `number`. */
export const storyPointsSchema = z.literal(STORY_POINTS, {
  error: 'Use 0, 1, 2, 3, 5, 8, 13 or 21',
});

const uniqueIds = (max: number) =>
  z
    .array(objectIdSchema)
    .max(max)
    .refine((a) => new Set(a).size === a.length, 'Duplicate ids');

export const taskTitleSchema = z
  .string()
  .trim()
  .min(1, 'Title is required')
  .max(200, 'At most 200 characters');

// No .default()s here: the service applies defaults, so .partial() stays truly partial.
const taskFields = {
  title: taskTitleSchema,
  description: z.string().max(10_000, 'At most 10,000 characters'),
  assigneeIds: uniqueIds(LIMITS.assigneesPerTask),
  priority: z.enum(PRIORITIES),
  dueDate: dueDateSchema.nullable(),
  labelIds: uniqueIds(LIMITS.labelsPerTask),
  storyPoints: storyPointsSchema.nullable(),
};

export const createTaskSchema = z.object(taskFields).partial().required({ title: true }).extend({
  columnId: objectIdSchema.optional(),
  sprintId: objectIdSchema.nullish(),
});

/** Unknown keys (workspaceId, number, reporterId, columnId, rank…) are stripped by Zod. */
export const updateTaskSchema = z
  .object(taskFields)
  .partial()
  .extend({ expectedVersion: z.number().int().positive().optional() })
  .refine((o) => Object.keys(o).some((k) => k !== 'expectedVersion'), 'Nothing to update');

export const BOARD_VIEWS = ['active', 'backlog', 'all'] as const;
export const boardQuery = z.object({
  sprint: z.union([z.enum(BOARD_VIEWS), objectIdSchema]).default('active'),
});

export const taskIdParams = z.object({ taskId: objectIdSchema });
export const taskNumberParams = keyParams.extend({
  number: z.coerce.number().int().positive(),
});

export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;
export type BoardView = z.infer<typeof boardQuery>['sprint'];
