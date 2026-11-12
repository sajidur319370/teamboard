import type { Types } from 'mongoose';
import { PRIORITIES, type Priority, type TaskCardDto, type TaskDto } from '@teamboard/shared';

type Id = Types.ObjectId;

/** A lean task document (all fields optional except the ones every task has). */
export type TaskLike = {
  _id: Id;
  projectId: Id;
  number: number;
  title: string;
  columnId: Id;
  rank: string;
  assigneeIds?: Id[] | null;
  priority?: string | null;
  dueDate?: string | null;
  labelIds?: Id[] | null;
  storyPoints?: number | null;
  sprintId?: Id | null;
  completedAt?: Date | null;
  commentCount?: number | null;
  version?: number | null;
  description?: string | null;
  reporterId?: Id;
  watcherIds?: Id[] | null;
  createdAt?: Date;
  updatedAt?: Date;
};

const ids = (a?: Id[] | null) => (a ?? []).map(String);
const asPriority = (p?: string | null): Priority =>
  (PRIORITIES as readonly string[]).includes(p ?? '') ? (p as Priority) : 'none';

export const toTaskCard = (t: TaskLike): TaskCardDto => ({
  id: String(t._id),
  projectId: String(t.projectId),
  number: t.number,
  title: t.title,
  columnId: String(t.columnId),
  rank: t.rank,
  assigneeIds: ids(t.assigneeIds),
  priority: asPriority(t.priority),
  dueDate: t.dueDate ?? null,
  labelIds: ids(t.labelIds),
  storyPoints: t.storyPoints ?? null,
  sprintId: t.sprintId ? String(t.sprintId) : null,
  completedAt: t.completedAt?.toISOString() ?? null,
  commentCount: t.commentCount ?? 0,
  version: t.version ?? 1,
});

export const toTaskDto = (t: TaskLike): TaskDto => ({
  ...toTaskCard(t),
  description: t.description ?? '',
  reporterId: String(t.reporterId),
  watcherIds: ids(t.watcherIds),
  createdAt: (t.createdAt ?? new Date(0)).toISOString(),
  updatedAt: (t.updatedAt ?? new Date(0)).toISOString(),
});
