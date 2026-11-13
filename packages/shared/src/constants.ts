// Shared by the API and the web app. Source: teamboard-docs/2-design/schema.md §2.
// Rule: no `enum`, no class parameter properties, no Node or browser APIs.

export const ROLES = ['owner', 'admin', 'member', 'viewer'] as const;
export type Role = (typeof ROLES)[number];
export const isRole = (v: unknown): v is Role =>
  typeof v === 'string' && (ROLES as readonly string[]).includes(v);

export const ROLE_LEVEL: Record<Role, number> = {
  owner: 40,
  admin: 30,
  member: 20,
  viewer: 10,
};

export const INVITABLE_ROLES = ['admin', 'member', 'viewer'] as const;

export const COLUMN_CATEGORIES = ['todo', 'in_progress', 'done'] as const;
export type ColumnCategory = (typeof COLUMN_CATEGORIES)[number];

export const PRIORITIES = ['urgent', 'high', 'medium', 'low', 'none'] as const;
export type Priority = (typeof PRIORITIES)[number];

export const STORY_POINTS = [0, 1, 2, 3, 5, 8, 13, 21] as const;
export type StoryPoint = (typeof STORY_POINTS)[number];

export const SPRINT_STATES = ['planned', 'active', 'completed'] as const;
export type SprintState = (typeof SPRINT_STATES)[number];

export const PALETTE = [
  'gray',
  'red',
  'orange',
  'yellow',
  'green',
  'teal',
  'blue',
  'indigo',
  'purple',
  'pink',
] as const;
export type PaletteColor = (typeof PALETTE)[number];
export const isPaletteColor = (v: unknown): v is PaletteColor =>
  typeof v === 'string' && (PALETTE as readonly string[]).includes(v);

export const ENTITY_TYPES = [
  'workspace',
  'membership',
  'invite',
  'project',
  'task',
  'comment',
  'sprint',
] as const;

export const ACTIVITY_ACTIONS = [
  'workspace.created',
  'workspace.updated',
  'member.joined',
  'member.role_changed',
  'member.removed',
  'member.left',
  'ownership.transferred',
  'invite.created',
  'invite.revoked',
  'project.created',
  'project.updated',
  'project.archived',
  'project.unarchived',
  'project.deleted',
  'column.created',
  'column.renamed',
  'column.deleted',
  'column.reordered',
  'task.created',
  'task.updated',
  'task.assigned',
  'task.unassigned',
  'task.moved',
  'task.completed',
  'task.reopened',
  'task.added_to_sprint',
  'task.removed_from_sprint',
  'task.deleted',
  'comment.created',
  'comment.deleted',
  'sprint.created',
  'sprint.started',
  'sprint.completed',
  'sprint.deleted',
] as const;
export type ActivityAction = (typeof ACTIVITY_ACTIONS)[number];

/** Actions whose metadata carries scopeDelta/doneDelta (see data-model.md §12). */
export const BURNDOWN_ACTIONS = [
  'task.added_to_sprint',
  'task.removed_from_sprint',
  'task.completed',
  'task.reopened',
  'task.updated',
] as const;

export const NOTIFICATION_TYPES = [
  'task.assigned',
  'task.unassigned',
  'comment.created',
  'task.completed',
  'task.updated',
  'member.role_changed',
  'invite.accepted',
  'ownership.transferred',
  'sprint.started',
  'sprint.completed',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const LIMITS = {
  workspacesPerUser: 10,
  membersPerWorkspace: 50,
  projectsPerWorkspace: 50,
  columnsPerProject: 15,
  labelsPerProject: 30,
  assigneesPerTask: 5,
  labelsPerTask: 10,
  watchersPerTask: 50,
  rankMaxLength: 50, // rebalance trigger
  inviteMaxUses: 50,
  sprintMaxDays: 28,
} as const;

export const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
export const SLUG = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/;
export const PROJECT_KEY = /^[A-Z][A-Z0-9]{1,5}$/;
