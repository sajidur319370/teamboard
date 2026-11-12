// Response shapes shared by the API (which builds them) and the web app (which reads them).
import type { ColumnCategory, PaletteColor, Priority, Role } from './constants';

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

export interface ColumnDto {
  id: Id;
  name: string;
  category: ColumnCategory;
  position: number;
  wipLimit: number | null;
}

export interface LabelDto {
  id: Id;
  name: string;
  color: PaletteColor;
}

export interface ProjectDto {
  id: Id;
  key: string;
  name: string;
  description: string;
  leadId: Id | null;
  columns: ColumnDto[]; // sorted by position
  labels: LabelDto[];
  archivedAt: string | null;
}

export interface ProjectListItemDto {
  id: Id;
  key: string;
  name: string;
  leadId: Id | null;
  openTasks: number;
  activeSprint: { id: Id; name: string } | null; // filled in on Day 18
  archivedAt: string | null;
}

/** What a card on the board needs (the task model's CARD_FIELDS). */
export interface TaskCardDto {
  id: Id;
  projectId: Id;
  number: number;
  title: string;
  columnId: Id;
  rank: string;
  assigneeIds: Id[];
  priority: Priority;
  dueDate: string | null; // YYYY-MM-DD
  labelIds: Id[];
  storyPoints: number | null;
  sprintId: Id | null;
  completedAt: string | null;
  commentCount: number;
  version: number;
}

/** The full task, for the drawer. */
export interface TaskDto extends TaskCardDto {
  description: string;
  reporterId: Id;
  watcherIds: Id[];
  createdAt: string;
  updatedAt: string;
}

export interface BoardMemberDto {
  userId: Id;
  name: string;
  avatarColor: PaletteColor;
  role: Role;
}

export interface SprintSummaryDto {
  id: Id;
  name: string;
  number: number;
  goal: string;
  startDate: string;
  endDate: string;
}

/** GET /projects/:key/board: everything the board needs in ONE request (FR-BRD-10). */
export interface BoardResponse {
  project: ProjectDto;
  view: 'active' | 'backlog' | 'all' | Id;
  activeSprint: SprintSummaryDto | null;
  tasks: TaskCardDto[]; // sorted by (columnId, rank); the client groups them into columns
  members: BoardMemberDto[];
  /** Users no longer in the workspace but still assigned to a task here (FR-MEM-06c). */
  formerMembers: { userId: Id; name: string; avatarColor: PaletteColor }[];
}

/** GET /my-tasks (FR-TSK-11): open tasks assigned to me, plus the projects to group them by. */
export interface MyTasksResponse {
  tasks: TaskCardDto[];
  projects: { id: Id; key: string; name: string }[];
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
