import type { BoardResponse, TaskCardDto } from '@teamboard/shared';

/**
 * Same order as MongoDB: plain binary compare of rank (NEVER localeCompare, which sorts
 * "a0V" and "a0v" differently from the database), then id as the tie-breaker (FR-ORD-01).
 */
export function byRank(a: Pick<TaskCardDto, 'rank' | 'id'>, b: Pick<TaskCardDto, 'rank' | 'id'>) {
  if (a.rank !== b.rank) return a.rank < b.rank ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export type Columns = Record<string, TaskCardDto[]>;

/**
 * Derive columnId → sorted cards from the flat server list. Derived with useMemo, never
 * stored in state, so it can't drift from the query cache.
 */
export function groupByColumn(
  board: Pick<BoardResponse, 'project' | 'tasks'>,
  visible: (t: TaskCardDto) => boolean = () => true,
): Columns {
  const cols: Columns = Object.fromEntries(
    board.project.columns.map((c) => [c.id, [] as TaskCardDto[]]),
  );
  for (const t of board.tasks) if (visible(t)) cols[t.columnId]?.push(t);
  for (const list of Object.values(cols)) list.sort(byRank);
  return cols;
}
