// The public demo: one workspace with a login per role (seeded by apps/api/src/demo).
import { z } from 'zod';

export const DEMO_EMAIL_DOMAIN = 'demo.teamboard.dev';
export const DEMO_WORKSPACE_SLUG = 'acme';
export const DEMO_ROLES = ['owner', 'admin', 'member', 'viewer'] as const;
export type DemoRole = (typeof DEMO_ROLES)[number];

export const demoEmail = (role: DemoRole) => `${role}@${DEMO_EMAIL_DOMAIN}`;
export const isDemoEmail = (email: string) => email.toLowerCase().endsWith(`@${DEMO_EMAIL_DOMAIN}`);

export const demoLoginSchema = z.object({ role: z.enum(DEMO_ROLES) });

/** GET /api/auth/demo: whether the login page shows the one-click demo buttons. */
export interface DemoInfo {
  enabled: boolean;
  accounts: { role: DemoRole; email: string }[];
  /** The demo data is rebuilt when it is older than this (null = never). */
  resetHours: number | null;
}
