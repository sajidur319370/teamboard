import { describe, expect, it } from 'vitest';
import type { MemberDto, Role } from '@teamboard/shared';
import { canRevokeInvite, memberActions } from './memberRules';

const member = (userId: string, role: Role): MemberDto => ({
  userId,
  role,
  name: userId,
  email: `${userId}@test.dev`,
  avatarColor: 'blue',
  joinedAt: '2026-01-01T00:00:00.000Z',
});

describe('memberActions', () => {
  it('an Owner may manage everyone else and grant admin', () => {
    const a = memberActions('owner', 'me', member('x', 'viewer'));
    expect(a).toMatchObject({ canChangeRole: true, canRemove: true });
    expect(a.roleOptions).toEqual(['viewer', 'admin', 'member']);
  });

  it("an Admin manages Members and Viewers but never sees 'admin' as an option", () => {
    const a = memberActions('admin', 'me', member('x', 'member'));
    expect(a.roleOptions).toEqual(['member', 'viewer']);
    expect(memberActions('admin', 'me', member('y', 'admin')).canChangeRole).toBe(false);
    expect(memberActions('admin', 'me', member('z', 'owner')).canRemove).toBe(false);
  });

  it('nobody manages themselves', () => {
    const a = memberActions('owner', 'me', member('me', 'owner'));
    expect(a).toMatchObject({ isMe: true, canChangeRole: false, canRemove: false });
    expect(a.roleOptions).toEqual(['owner']);
  });

  it('Members and Viewers manage nobody (member:updateRole is admin+)', () => {
    // canManageMember alone would let a Member manage a Viewer; the UI hides the whole
    // column behind <Can perm="member:updateRole">, matching the API's authorize().
    expect(memberActions('viewer', 'me', member('x', 'viewer')).canRemove).toBe(false);
  });
});

describe('canRevokeInvite', () => {
  it('follows the invite ceiling', () => {
    expect(canRevokeInvite('owner', { role: 'admin' })).toBe(true);
    expect(canRevokeInvite('admin', { role: 'admin' })).toBe(false);
    expect(canRevokeInvite('admin', { role: 'viewer' })).toBe(true);
  });
});
