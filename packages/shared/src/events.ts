// The real-time contract between API and web (requirement §12.2). Typed on both ends, so an
// event name or payload can't drift between the server that emits it and the client that
// listens. Clients NEVER write over the socket (FR-RT-05): only these joins/leaves go up.
import type { Role } from './constants';
import type { ColumnDto, Id, MemberDto, ProjectDto, TaskCardDto } from './dto';

/** Fields on EVERY server→client payload (FR-RT-07). */
export interface Envelope {
  workspaceId: Id;
  projectId?: Id;
  actorId: Id;
  /** Set when the triggering request had one; that tab ignores its own echo (FR-RT-08). */
  clientMutationId?: string;
  emittedAt: string;
}

type E<P> = (payload: Envelope & P) => void;

export interface ServerToClientEvents {
  // board:<projectId>
  'task:created': E<{ task: TaskCardDto }>;
  'task:updated': E<{ task: TaskCardDto; changedFields: string[] }>;
  'task:moved': E<{ task: TaskCardDto; fromColumnId: Id }>;
  'task:deleted': E<{ taskId: Id; number: number }>;
  'column:created': E<{ columns: ColumnDto[] }>;
  'column:updated': E<{ columns: ColumnDto[] }>;
  'column:deleted': E<{ columns: ColumnDto[]; movedTaskIds: Id[] }>;
  'column:reordered': E<{ columns: ColumnDto[] }>;
  'column:rebalanced': E<{ columnId: Id; ranks: Record<Id, string> }>;
  // workspace:<id> (and the project's own board room)
  'project:created': E<{ project: ProjectDto }>;
  'project:updated': E<{ project: ProjectDto }>;
  'project:archived': E<{ project: ProjectDto }>;
  'project:deleted': E<{ project: ProjectDto }>;
  'member:joined': E<{ member: MemberDto }>;
  'member:roleChanged': E<{ member: MemberDto }>;
  'member:removed': E<{ userId: Id }>;
  // user:<id>
  'membership:revoked': (p: { workspaceId: Id }) => void;
  'membership:roleChanged': (p: { workspaceId: Id; role: Role }) => void;
  // Day 16: comment:*  ·  Day 17: notification:new  ·  Day 18: sprint:*, tasks:sprintChanged
}

export type Ack = { ok: true } | { ok: false; code: string };

export interface ClientToServerEvents {
  'workspace:join': (p: { workspaceId: Id }, ack: (r: Ack) => void) => void;
  'board:join': (p: { projectId: Id }, ack: (r: Ack) => void) => void;
  'board:leave': (p: { projectId: Id }) => void;
}

export interface SocketData {
  userId: string;
  workspaceId: string | null;
}

/** Room names, in ONE place: a typo here would silently send events to nobody. */
export const rooms = {
  user: (userId: Id) => `user:${userId}`,
  workspace: (workspaceId: Id) => `workspace:${workspaceId}`,
  board: (projectId: Id) => `board:${projectId}`,
};
