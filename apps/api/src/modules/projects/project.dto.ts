import type { Types } from 'mongoose';
import {
  isPaletteColor,
  type ColumnCategory,
  type ColumnDto,
  type LabelDto,
  type ProjectDto,
} from '@teamboard/shared';

type ColumnLike = {
  _id: Types.ObjectId;
  name: string;
  category: string;
  position: number;
  wipLimit?: number | null;
};
type LabelLike = { _id: Types.ObjectId; name: string; color: string };
type ProjectLike = {
  _id: Types.ObjectId;
  key: string;
  name: string;
  description?: string | null;
  leadId?: Types.ObjectId | null;
  columns: ColumnLike[];
  labels?: LabelLike[] | null;
  archivedAt?: Date | null;
};

export const toColumnDto = (c: ColumnLike): ColumnDto => ({
  id: String(c._id),
  name: c.name,
  category: c.category as ColumnCategory,
  position: c.position,
  wipLimit: c.wipLimit ?? null,
});

export const toLabelDto = (l: LabelLike): LabelDto => ({
  id: String(l._id),
  name: l.name,
  color: isPaletteColor(l.color) ? l.color : 'gray',
});

export const sortedColumns = (cols: ColumnLike[]) =>
  [...cols].sort((a, b) => a.position - b.position).map(toColumnDto);

export const toProjectDto = (p: ProjectLike): ProjectDto => ({
  id: String(p._id),
  key: p.key,
  name: p.name,
  description: p.description ?? '',
  leadId: p.leadId ? String(p.leadId) : null,
  columns: sortedColumns(p.columns),
  labels: (p.labels ?? []).map(toLabelDto),
  archivedAt: p.archivedAt?.toISOString() ?? null,
});
