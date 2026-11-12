import type { Types } from 'mongoose';
import type { WorkspaceDto } from '@teamboard/shared';

type WsLike = {
  _id: Types.ObjectId;
  name: string;
  slug: string;
  ownerId: Types.ObjectId;
  settings?: {
    timezone?: string | null;
    weekStartsOn?: number | null;
    workingDays?: number[] | null;
  } | null;
};

export const toWorkspaceDto = (w: WsLike): WorkspaceDto => ({
  id: String(w._id),
  name: w.name,
  slug: w.slug,
  ownerId: String(w.ownerId),
  settings: {
    timezone: w.settings?.timezone ?? 'UTC',
    weekStartsOn: w.settings?.weekStartsOn ?? 1,
    workingDays: w.settings?.workingDays ?? [1, 2, 3, 4, 5],
  },
});
