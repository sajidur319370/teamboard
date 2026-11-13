// Response shapes shared by the API (which builds them) and the web app (which reads them).
import type {
  ColumnCategory,
  NotificationType,
  PaletteColor,
  Priority,
  Role,
  SprintState,
} from './constants';

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

/** PATCH /tasks/:taskId/move. `noop`: the card was already there, nothing was written. */
export interface MoveTaskResponse {
  task: TaskCardDto;
  noop: boolean;
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

/** Who did or wrote something, hydrated in one query per page (no N+1). */
export interface PersonRef {
  id: Id;
  name: string; // "Former user" when the account is gone
  avatarColor: PaletteColor;
}

/** Cursor pagination on (createdAt, _id): `nextCursor` is null on the last page. */
export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export interface CommentDto {
  id: Id;
  taskId: Id;
  author: PersonRef;
  body: string; // Markdown, rendered with SafeMarkdown
  editedAt: string | null;
  createdAt: string;
}

/** POST /tasks/:taskId/comments and DELETE /comments/:id return the task's new count. */
export interface CreateCommentResponse {
  comment: CommentDto;
  commentCount: number;
}
export interface DeleteCommentResponse {
  commentCount: number;
}

/** A snapshot for rendering, so the bell still reads right after renames and deletes. */
export interface NotificationData {
  projectKey?: string;
  taskNumber?: number;
  taskTitle?: string;
  role?: Role;
  excerpt?: string; // comment.created
  fields?: ('dueDate' | 'priority')[]; // task.updated (N5)
  sprintName?: string; // Day 18
}

export interface NotificationDto {
  id: Id;
  type: NotificationType;
  actor: PersonRef;
  projectId: Id | null;
  taskId: Id | null;
  data: NotificationData;
  readAt: string | null;
  createdAt: string;
}

export interface SprintScopeDto {
  totalTasks: number;
  totalPoints: number;
  doneTasks: number; // already done when the sprint started (D4)
  donePoints: number;
}

export interface SprintDto {
  id: Id;
  projectId: Id;
  number: number;
  name: string;
  goal: string;
  state: SprintState;
  startDate: string; // YYYY-MM-DD
  endDate: string;
  startedAt: string | null;
  completedAt: string | null;
  /** The snapshot taken at start (FR-SPR-06); null while planned. */
  scope: SprintScopeDto | null;
}

/** GET /projects/:key/backlog (FR-SPR-03): open tasks, grouped. */
export interface BacklogResponse {
  /** Active first, then planned by start date. */
  sprints: { sprint: SprintDto; tasks: TaskCardDto[] }[];
  /** sprintId = null, by priority then creation. */
  backlog: TaskCardDto[];
}
