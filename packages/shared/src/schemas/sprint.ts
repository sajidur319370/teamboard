import { z } from 'zod';
import { LIMITS, SPRINT_STATES } from '../constants';
import { daysBetween } from '../dates';
import { objectIdSchema } from './common';
import { dueDateSchema as day } from './task'; // a real calendar date (no Feb 30)

/** FR-SPR-01: end after start, 1–28 days. Shared with the service for partial updates. */
export const validSprintRange = (startDate: string, endDate: string) => {
  const d = daysBetween(startDate, endDate);
  return d >= 1 && d <= LIMITS.sprintMaxDays;
};
const RANGE_MSG = `End must be 1–${LIMITS.sprintMaxDays} days after start`;
const rangeOk = (o: { startDate?: string | undefined; endDate?: string | undefined }) =>
  !o.startDate || !o.endDate || validSprintRange(o.startDate, o.endDate);

const name = z.string().trim().min(1, 'Required').max(60);
const goal = z.string().trim().max(500);

export const createSprintSchema = z
  .object({
    name: name.optional(), // default "Sprint N"
    goal: goal.default(''),
    startDate: day,
    endDate: day,
  })
  .refine(rangeOk, { message: RANGE_MSG, path: ['endDate'] });
export type CreateSprintInput = z.infer<typeof createSprintSchema>;

export const updateSprintSchema = z
  .object({ name, goal, startDate: day, endDate: day })
  .partial()
  .refine((o) => Object.keys(o).length > 0, { message: 'Nothing to update' })
  .refine(rangeOk, { message: RANGE_MSG, path: ['endDate'] });
export type UpdateSprintInput = z.infer<typeof updateSprintSchema>;

export const sprintTasksSchema = z.object({
  action: z.enum(['add', 'remove']),
  taskIds: z.array(objectIdSchema).min(1).max(200),
});
export type SprintTasksInput = z.infer<typeof sprintTasksSchema>;

export const completeSprintSchema = z.object({
  carryOverTo: z.union([z.literal('backlog'), objectIdSchema]),
});

export const sprintIdParams = z.object({ sprintId: objectIdSchema });
export const sprintListQuery = z.object({ state: z.enum(SPRINT_STATES).optional() });
