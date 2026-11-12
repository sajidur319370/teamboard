import { z } from 'zod';
import { SLUG } from '../constants';
import { timezoneSchema } from './common';

/** Union of the guide's list and FR-WS-02, so no workspace URL can shadow an app route. */
export const RESERVED_SLUGS = [
  'api',
  'app',
  'admin',
  'help',
  'invite',
  'login',
  'new',
  'register',
  'settings',
  'signup',
  'w',
  'www',
] as const;

/** "Acme Studio!" → "acme-studio" (a suggestion; the user can edit it) */
export function suggestSlug(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // "Café" → "cafe", not "caf-"
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');
}

export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(SLUG, 'Use 3–40 lowercase letters, digits or dashes (not at the start or end)')
  // params.code surfaces in the API's error details as issue: 'SLUG_RESERVED' (AC-WS-03)
  .refine((s) => !(RESERVED_SLUGS as readonly string[]).includes(s), {
    message: 'This URL is reserved',
    params: { code: 'SLUG_RESERVED' },
  });

export const workspaceNameSchema = z.string().trim().min(2, 'At least 2 characters').max(50);

const weekdaySchema = z.number().int().min(0).max(6); // 0 = Sunday

export const createWorkspaceSchema = z.object({ name: workspaceNameSchema, slug: slugSchema });

export const updateWorkspaceSchema = z
  .object({
    name: workspaceNameSchema,
    timezone: timezoneSchema,
    weekStartsOn: weekdaySchema,
    workingDays: z
      .array(weekdaySchema)
      .min(1, 'Pick at least one working day')
      .max(7)
      .refine((d) => new Set(d).size === d.length, 'Each day only once')
      .transform((d) => [...d].sort((a, b) => a - b)),
  })
  .partial();

export const deleteWorkspaceSchema = z.object({ confirmName: z.string().max(100) });

export type CreateWorkspaceInput = z.infer<typeof createWorkspaceSchema>;
export type UpdateWorkspaceInput = z.infer<typeof updateWorkspaceSchema>;
