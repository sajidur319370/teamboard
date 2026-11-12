// Response shapes shared by the API (which builds them) and the web app (which reads them).
import type { PaletteColor, Role } from './constants';

export type Id = string;

export interface UserDto {
  id: Id;
  email: string;
  name: string;
  avatarColor: PaletteColor;
  timezone: string;
}

export interface WorkspaceSummaryDto {
  id: Id;
  name: string;
  slug: string;
  role: Role;
}
export interface WorkspaceSettingsDto {
  timezone: string;
  weekStartsOn: number; // 0 = Sunday
  workingDays: number[];
}

export interface WorkspaceDto {
  id: Id;
  name: string;
  slug: string;
  ownerId: Id;
  settings: WorkspaceSettingsDto;
}

export interface WorkspaceResponse {
  workspace: WorkspaceDto;
  role: Role;
}

export interface MemberDto {
  userId: Id;
  name: string;
  email: string;
  avatarColor: PaletteColor;
  role: Role;
  joinedAt: string; // ISO
}

export type InviteStatus = 'active' | 'expired' | 'revoked' | 'used_up';

export interface InviteDto {
  id: Id;
  role: Role;
  email: string | null;
  maxUses: number;
  uses: number;
  expiresAt: string; // ISO
  createdAt: string; // ISO
  status: InviteStatus;
  createdBy: Id;
}

/** POST /invites: the full link is returned ONCE, at creation (FR-INV-02). */
export interface CreateInviteResponse {
  invite: InviteDto;
  url: string;
}

export interface InvitePreviewDto {
  workspace: { name: string; slug: string };
  role: Role;
  status: InviteStatus;
  emailLocked: boolean;
  inviterName: string;
}

export interface AcceptInviteResponse {
  slug: string;
}

export interface AuthResponse {
  accessToken: string;
  user: UserDto;
}

export interface RefreshResponse {
  accessToken: string;
}

export interface MeResponse {
  user: UserDto;
  workspaces: WorkspaceSummaryDto[];
}
// More DTOs are added day by day.
