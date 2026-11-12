import {
  canManageMember,
  grantableRoles,
  type InviteDto,
  type MemberDto,
  type Role,
} from '@teamboard/shared';

/**
 * What I may do to one row of the member list. Mirrors the API's rules (requirement §5.3)
 * so the UI only offers actions that will succeed; the API still enforces them.
 */
export function memberActions(myRole: Role, myUserId: string, m: MemberDto) {
  const isMe = m.userId === myUserId;
  const manageable = !isMe && canManageMember(myRole, m.role); // FR-RBAC-01, FR-RBAC-03
  return {
    isMe,
    canChangeRole: manageable,
    canRemove: manageable,
    /** Current role first, then the roles I may grant (FR-RBAC-02). */
    roleOptions: manageable
      ? [m.role, ...grantableRoles(myRole).filter((r) => r !== m.role)]
      : [m.role],
  };
}

/** FR-INV-04: I may revoke an invite of any role I could create. */
export const canRevokeInvite = (myRole: Role, invite: Pick<InviteDto, 'role'>) =>
  grantableRoles(myRole).includes(invite.role);
