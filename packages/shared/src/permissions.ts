// The single source of truth for who may do what (requirement §5.2).
// Used by the API's authorize() middleware AND the web app's <Can>, so they can never disagree.
import { ROLE_LEVEL, ROLES, type Role } from './constants';

/** Minimum role per permission. ◐ rules (own comment, own task) are checked in services. */
export const PERMISSIONS = {
  'workspace:view': 'viewer',
  'workspace:update': 'admin',
  'workspace:delete': 'owner',
  'workspace:transferOwnership': 'owner',
  'member:view': 'viewer',
  'member:updateRole': 'admin',
  'member:remove': 'admin',
  'member:leave': 'viewer', // the Owner is blocked in the service (must transfer first)
  'invite:view': 'admin',
  'invite:create': 'admin',
  'invite:revoke': 'admin',
  'project:view': 'viewer',
  'project:create': 'admin',
  'project:update': 'admin',
  'project:archive': 'admin',
  'project:delete': 'admin',
  'column:manage': 'admin',
  'sprint:view': 'viewer',
  'sprint:manage': 'admin',
  'sprint:assignTasks': 'member', // active sprint: admin, checked in the service
  'task:view': 'viewer',
  'task:create': 'member',
  'task:update': 'member',
  'task:move': 'member',
  'task:delete': 'member', // members: own tasks only (service)
  'comment:view': 'viewer',
  'comment:create': 'member',
  'comment:update': 'member', // author only (service)
  'comment:delete': 'member', // author or admin (service)
  'activity:view': 'viewer',
  'report:view': 'viewer',
  'notification:own': 'viewer',
} as const satisfies Record<string, Role>;

export type Permission = keyof typeof PERMISSIONS;

export const can = (role: Role | null | undefined, permission: Permission): boolean =>
  !!role && ROLE_LEVEL[role] >= ROLE_LEVEL[PERMISSIONS[permission]];

/** FR-RBAC-01: you may change the role of, or remove, members strictly below you. */
export const canManageMember = (actor: Role, target: Role) =>
  ROLE_LEVEL[target] < ROLE_LEVEL[actor];

export const rolesBelow = (r: Role): Role[] => ROLES.filter((x) => ROLE_LEVEL[x] < ROLE_LEVEL[r]);

/** FR-RBAC-02: grant roles below yours; the Owner may also grant admin. Nobody grants owner. */
export const grantableRoles = (r: Role): Role[] =>
  r === 'owner' ? ['admin', 'member', 'viewer'] : rolesBelow(r);
