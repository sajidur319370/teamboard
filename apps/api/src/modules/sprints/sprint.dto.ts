import type { Types } from 'mongoose';
import type { SprintDto, SprintState, SprintSummaryDto } from '@teamboard/shared';

export type SprintLike = {
  _id: Types.ObjectId;
  projectId: Types.ObjectId;
  number: number;
  name: string;
  goal?: string | null;
  state?: string | null;
  startDate: string;
  endDate: string;
  startedAt?: Date | null;
  completedAt?: Date | null;
  scopeSnapshot?: {
    totalTasks: number;
    totalPoints: number;
    doneTasks: number;
    donePoints: number;
  } | null;
};

export const toSprintDto = (s: SprintLike): SprintDto => ({
  id: String(s._id),
  projectId: String(s.projectId),
  number: s.number,
  name: s.name,
  goal: s.goal ?? '',
  state: (s.state ?? 'planned') as SprintState,
  startDate: s.startDate,
  endDate: s.endDate,
  startedAt: s.startedAt?.toISOString() ?? null,
  completedAt: s.completedAt?.toISOString() ?? null,
  // The snapshot's taskIds stay on the server (the report needs them, the client doesn't).
  scope: s.scopeSnapshot
    ? {
        totalTasks: s.scopeSnapshot.totalTasks,
        totalPoints: s.scopeSnapshot.totalPoints,
        doneTasks: s.scopeSnapshot.doneTasks,
        donePoints: s.scopeSnapshot.donePoints,
      }
    : null,
});

export const toSprintSummary = (s: SprintLike): SprintSummaryDto => ({
  id: String(s._id),
  name: s.name,
  number: s.number,
  goal: s.goal ?? '',
  startDate: s.startDate,
  endDate: s.endDate,
});
