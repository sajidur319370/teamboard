import type { InviteStatus, Role } from '@teamboard/shared';

export const ROLE_LABEL: Record<Role, string> = {
  owner: 'Owner',
  admin: 'Admin',
  member: 'Member',
  viewer: 'Viewer',
};

export const ROLE_HINT: Record<Role, string> = {
  owner: 'Everything, including deleting the workspace',
  admin: 'Manage projects, sprints, invites and members below admin',
  member: 'Create, edit and move tasks; comment',
  viewer: 'Read-only',
};

export const INVITE_STATUS_TEXT: Record<InviteStatus, string> = {
  active: 'active',
  expired: 'expired',
  revoked: 'been revoked',
  used_up: 'been used up',
};

const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 86_400_000],
  ['month', 30 * 86_400_000],
  ['week', 7 * 86_400_000],
  ['day', 86_400_000],
  ['hour', 3_600_000],
  ['minute', 60_000],
];

/** "in 6 days", "2 hours ago", "now" */
export function relativeTime(iso: string, now = Date.now()): string {
  const diff = Date.parse(iso) - now;
  for (const [unit, ms] of UNITS) {
    if (Math.abs(diff) >= ms) return rtf.format(Math.round(diff / ms), unit);
  }
  return 'now';
}

/** "12 Nov 2026" in the viewer's locale */
export const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
