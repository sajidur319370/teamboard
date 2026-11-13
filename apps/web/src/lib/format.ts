import type { InviteStatus, Priority, Role } from '@teamboard/shared';

export const PRIORITY_LABEL: Record<Priority, string> = {
  urgent: 'Urgent',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
  none: 'None',
};

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

/** "Oct 19" for a YYYY-MM-DD day (noon, so no timezone can shift it to another day). */
export const dayLabel = (day: string) =>
  new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

/** "Oct 19 – Oct 28" */
export const dayRange = (start: string, end: string) => `${dayLabel(start)} – ${dayLabel(end)}`;

/** "1 task", "3 tasks" */
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
