// What each activity stores in `metadata` (schema.md §13, requirement §13.2). Writers (the
// API's activity() helper) and the renderer (the web's renderActivity) both use this map, so
// a field can't be written under one name and read under another.
import type { ActivityAction, ColumnCategory, Role } from './constants';
import type { Id, PersonRef } from './dto';

/** Snapshots, so a sentence still renders after renames and deletes (FR-ACT-04). */
export type TaskRef = { number: number; title: string; key: string };
export type ColumnRef = { columnId: Id; name: string };
/** `name` is a snapshot; rows written before Day 16 only have the id. */
export type UserRef = { id: Id; name?: string };
type Delta = { count: number; points: number };
type BurndownDelta = { scopeDelta: Delta; doneDelta: Delta }; // Day 18
type SprintRef = { name: string; number: number };
type OnTask = { task: TaskRef };

export interface ActivityMetadataMap {
  'workspace.created': { name: string };
  'workspace.updated': {
    changes: { name?: string; timezone?: string; weekStartsOn?: number; workingDays?: number[] };
  };
  'member.joined': { role: Role };
  'member.role_changed': { user: UserRef; from: Role; to: Role };
  'member.removed': { user: UserRef; role: Role };
  'member.left': { role: Role };
  /** Pre-Day-16 rows store bare ids here. */
  'ownership.transferred': { from: UserRef | Id; to: UserRef | Id };
  'invite.created': { role: Role };
  'invite.revoked': { role: Role };
  'project.created': { name: string; key: string };
  'project.updated': { changes: string[]; name?: string; key?: string };
  'project.archived': { name: string; key?: string };
  'project.unarchived': { name: string; key?: string };
  'project.deleted': { name: string; key: string };
  'column.created': { name: string; category: ColumnCategory };
  'column.renamed': { from: string; to: string };
  'column.deleted': { name: string; movedTo: string | null; movedTasks: number };
  'column.reordered': { order: Id[] };
  'task.created': OnTask & { column: ColumnRef };
  /** description: no from/to (FR-ACT-08). labelIds: id arrays. */
  'task.updated': OnTask & { field: string; from?: unknown; to?: unknown } & Partial<BurndownDelta>;
  'task.assigned': OnTask & { user: UserRef };
  'task.unassigned': OnTask & { user: UserRef };
  'task.moved': OnTask & { from: ColumnRef; to: ColumnRef };
  'task.completed': OnTask & Partial<BurndownDelta>;
  'task.reopened': OnTask & Partial<BurndownDelta>;
  'task.added_to_sprint': OnTask & { sprint: { name: string } } & BurndownDelta;
  'task.removed_from_sprint': OnTask & { sprint: { name: string } } & BurndownDelta;
  'task.deleted': OnTask;
  'comment.created': OnTask & { excerpt: string };
  /** Pre-Day-16 rows are `{}`. */
  'comment.deleted': Partial<OnTask>;
  'sprint.created': { sprint: SprintRef };
  'sprint.started': { sprint: SprintRef };
  'sprint.completed': { sprint: SprintRef };
  'sprint.deleted': { sprint: SprintRef };
}

// Compile-time check: the map has exactly one entry per action, no more, no fewer.
type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const exhaustive: Exact<keyof ActivityMetadataMap, ActivityAction> = true;
void exhaustive;

export type ActivityMetadata<A extends ActivityAction = ActivityAction> = ActivityMetadataMap[A];

interface ActivityBase {
  id: Id;
  actor: PersonRef;
  projectId: Id | null;
  taskId: Id | null;
  sprintId: Id | null;
  createdAt: string;
}

/**
 * A discriminated union: `switch (a.action)` narrows `a.metadata` to that action's shape,
 * and `default: never` fails to compile while any action is unrendered.
 */
export type ActivityDto = {
  [A in ActivityAction]: ActivityBase & { action: A; metadata: ActivityMetadataMap[A] };
}[ActivityAction];
