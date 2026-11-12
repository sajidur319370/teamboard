// Response shapes shared by the API (which builds them) and the web app (which reads them).
import type { Role } from './constants';

export type Id = string;

export interface UserDto {
  id: Id;
  email: string;
  name: string;
  avatarColor: string;
  timezone: string;
}

export interface WorkspaceSummaryDto {
  id: Id;
  name: string;
  slug: string;
  role: Role;
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
