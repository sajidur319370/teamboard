import { describe, expect, it } from 'vitest';
import {
  PERMISSIONS,
  ROLES,
  can,
  canManageMember,
  grantableRoles,
  rolesBelow,
  type Permission,
  type Role,
} from '@teamboard/shared';

// requirement.md §5.2, typed in by hand as [owner, admin, member, viewer].
// ◐ rows are "allowed at the route, narrowed in the service", so they count as ✅ here.
// member:leave is ❌ for the Owner in the doc, but that's a service rule (must transfer first).
const MATRIX: Record<Permission, [boolean, boolean, boolean, boolean]> = {
  'workspace:view': [true, true, true, true],
  'workspace:update': [true, true, false, false],
  'workspace:delete': [true, false, false, false],
  'workspace:transferOwnership': [true, false, false, false],
  'member:view': [true, true, true, true],
  'member:updateRole': [true, true, false, false],
  'member:remove': [true, true, false, false],
  'member:leave': [true, true, true, true],
  'invite:view': [true, true, false, false],
  'invite:create': [true, true, false, false],
  'invite:revoke': [true, true, false, false],
  'project:view': [true, true, true, true],
  'project:create': [true, true, false, false],
  'project:update': [true, true, false, false],
  'project:archive': [true, true, false, false],
  'project:delete': [true, true, false, false],
  'column:manage': [true, true, false, false],
  'sprint:view': [true, true, true, true],
  'sprint:manage': [true, true, false, false],
  'sprint:assignTasks': [true, true, true, false],
  'task:view': [true, true, true, true],
  'task:create': [true, true, true, false],
  'task:update': [true, true, true, false],
  'task:move': [true, true, true, false],
  'task:delete': [true, true, true, false],
  'comment:view': [true, true, true, true],
  'comment:create': [true, true, true, false],
  'comment:update': [true, true, true, false],
  'comment:delete': [true, true, true, false],
  'activity:view': [true, true, true, true],
  'report:view': [true, true, true, true],
  'notification:own': [true, true, true, true],
};

describe('permission map', () => {
  it('has exactly the permissions of the requirement matrix', () => {
    expect(Object.keys(PERMISSIONS).sort()).toEqual(Object.keys(MATRIX).sort());
  });

  const cases = (Object.keys(MATRIX) as Permission[]).flatMap((perm) =>
    ROLES.map((role, i) => [role, perm, MATRIX[perm][i]] as const),
  );
  it.each(cases)('%s → %s = %s', (role, perm, expected) => {
    expect(can(role, perm)).toBe(expected);
  });

  it('nobody without a role can do anything', () => {
    for (const perm of Object.keys(PERMISSIONS) as Permission[]) {
      expect(can(null, perm)).toBe(false);
      expect(can(undefined, perm)).toBe(false);
    }
  });
});

describe('role ceiling (requirement §5.3)', () => {
  // [actor, target, may manage]
  const pairs: [Role, Role, boolean][] = [
    ['owner', 'admin', true],
    ['owner', 'member', true],
    ['owner', 'viewer', true],
    ['owner', 'owner', false],
    ['admin', 'member', true],
    ['admin', 'viewer', true],
    ['admin', 'admin', false], // FR-RBAC-01: not another Admin
    ['admin', 'owner', false],
    ['member', 'viewer', true], // the level rule holds; member:updateRole stops it at the route
    ['member', 'member', false],
    ['member', 'admin', false],
    ['member', 'owner', false],
    ['viewer', 'viewer', false],
    ['viewer', 'member', false],
    ['viewer', 'admin', false],
    ['viewer', 'owner', false],
  ];
  it.each(pairs)('canManageMember(%s, %s) = %s', (actor, target, expected) => {
    expect(canManageMember(actor, target)).toBe(expected);
  });

  it('grantable roles: below yours, the Owner may grant admin, nobody grants owner', () => {
    expect(grantableRoles('owner')).toEqual(['admin', 'member', 'viewer']);
    expect(grantableRoles('admin')).toEqual(['member', 'viewer']);
    expect(grantableRoles('member')).toEqual(['viewer']);
    expect(grantableRoles('viewer')).toEqual([]);
    for (const r of ROLES) expect(grantableRoles(r)).not.toContain('owner');
  });

  it('rolesBelow', () => {
    expect(rolesBelow('owner')).toEqual(['admin', 'member', 'viewer']);
    expect(rolesBelow('viewer')).toEqual([]);
  });
});
