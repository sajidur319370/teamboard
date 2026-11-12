import { z } from 'zod';
import { COLUMN_CATEGORIES, LIMITS, PALETTE, PROJECT_KEY } from '../constants';
import { objectIdSchema } from './common';

/** Uppercases BEFORE the regex, so `mob` in a URL or form is accepted as MOB. */
export const projectKeySchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(PROJECT_KEY, '2–6 letters or digits, starting with a letter');

/**
 * FR-PRJ-02: suggest a key from the name. "Mobile App" → "MA", "Website" → "WEB",
 * "Q4 Launch Plan 2" → "QLP2". The user can edit it; it never changes after creation.
 */
export function suggestProjectKey(name: string): string {
  const words = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // "Café" → "Cafe"
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter(Boolean);
  // A key must start with a letter: skip leading words that don't ("2026 Roadmap").
  const start = words.findIndex((w) => /^[A-Z]/.test(w));
  if (start === -1) return '';
  const rest = words.slice(start);
  const first = rest[0]!;
  let key = rest.length === 1 ? first.slice(0, 3) : rest.map((w) => w[0]).join('');
  if (key.length < 2) key = first.slice(0, 3); // e.g. ["X", "2"] → too short → "X…"
  key = key.slice(0, 6);
  return key.length >= 2 ? key : ''; // '' = "no good suggestion, let the user type one"
}

export const projectNameSchema = z.string().trim().min(2, 'At least 2 characters').max(80);

export const createProjectSchema = z.object({
  name: projectNameSchema,
  key: projectKeySchema,
  description: z.string().max(2000).default(''),
  leadId: objectIdSchema.nullish(),
});
/** The key never changes (BR-05), so it isn't editable here. */
export const updateProjectSchema = createProjectSchema.omit({ key: true }).partial();
export const deleteProjectSchema = z.object({ confirmKey: z.string().max(10) });
export const listProjectsQuery = z.object({
  archived: z.enum(['true', 'false']).optional(), // true = include archived (FR-PRJ-04)
});

export const columnNameSchema = z.string().trim().min(1, 'Required').max(30);
export const createColumnSchema = z.object({
  name: columnNameSchema,
  category: z.enum(COLUMN_CATEGORIES),
});
export const updateColumnSchema = createColumnSchema.partial();
export const reorderColumnsSchema = z.object({
  columnIds: z.array(objectIdSchema).min(2).max(LIMITS.columnsPerProject),
});
export const deleteColumnSchema = z.object({ targetColumnId: objectIdSchema.optional() });

export const labelSchema = z.object({
  name: z.string().trim().min(1, 'Required').max(20),
  color: z.enum(PALETTE),
});
export const updateLabelSchema = labelSchema.partial();

export const keyParams = z.object({ key: projectKeySchema });
export const columnParams = keyParams.extend({ columnId: objectIdSchema });
export const labelParams = keyParams.extend({ labelId: objectIdSchema });

export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;
export type CreateColumnInput = z.infer<typeof createColumnSchema>;
export type UpdateColumnInput = z.infer<typeof updateColumnSchema>;
export type LabelInput = z.infer<typeof labelSchema>;
export type UpdateLabelInput = z.infer<typeof updateLabelSchema>;
