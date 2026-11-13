// The drag-and-drop math, kept free of React and dnd-kit so it can be unit-tested.
import { generateKeyBetween } from 'fractional-indexing';
import type { BoardResponse, TaskCardDto } from '@teamboard/shared';
import { byRank, type Columns } from '../grouping';

export interface MoveVars {
  taskId: string;
  toColumnId: string;
  prevTaskId: string | null; // the card directly above the drop position
  nextTaskId: string | null; // the card directly below it
}

/** The column an id belongs to: either it IS a column id, or a card in one. */
export const findColumn = (id: string, cols: Columns): string | undefined =>
  id in cols ? id : Object.keys(cols).find((c) => cols[c]!.some((t) => t.id === id));

function arrayMove<T>(list: T[], from: number, to: number): T[] {
  const next = list.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item!);
  return next;
}

/**
 * onDragOver: while hovering another column, show the card THERE (in local state) so the
 * user sees where it will land. Returns `cols` itself when nothing changes, which keeps
 * React from re-rendering in a loop ("Maximum update depth exceeded").
 */
export function previewMove(cols: Columns, activeId: string, overId: string): Columns {
  const from = findColumn(activeId, cols);
  const to = findColumn(overId, cols);
  if (!from || !to || from === to) return cols;
  const moving = cols[from]!.find((t) => t.id === activeId);
  if (!moving) return cols;
  const target = cols[to]!;
  const overIndex = target.findIndex((t) => t.id === overId);
  const index = overIndex === -1 ? target.length : overIndex; // over the column itself → bottom
  return {
    ...cols,
    [from]: cols[from]!.filter((t) => t.id !== activeId),
    [to]: [...target.slice(0, index), { ...moving, columnId: to }, ...target.slice(index)],
  };
}

/**
 * onDragEnd: the final position as API input, or null when the card was dropped exactly
 * where it started (then no request is sent at all).
 * `start` = columns when the drag began; `current` = the live preview at drop time.
 */
export function computeDrop(
  start: Columns,
  current: Columns,
  activeId: string,
  overId: string,
): MoveVars | null {
  const col = findColumn(activeId, current);
  if (!col) return null;
  let list = current[col]!;
  const oldIndex = list.findIndex((t) => t.id === activeId);
  const overIndex = list.findIndex((t) => t.id === overId);
  if (overIndex !== -1 && overIndex !== oldIndex) list = arrayMove(list, oldIndex, overIndex);

  const i = list.findIndex((t) => t.id === activeId);
  const prevTaskId = list[i - 1]?.id ?? null;
  const nextTaskId = list[i + 1]?.id ?? null;

  const origCol = findColumn(activeId, start);
  if (origCol === col) {
    const orig = start[origCol]!;
    const oi = orig.findIndex((t) => t.id === activeId);
    const same =
      (orig[oi - 1]?.id ?? null) === prevTaskId && (orig[oi + 1]?.id ?? null) === nextTaskId;
    if (same) return null;
  }
  return { taskId: activeId, toColumnId: col, prevTaskId, nextTaskId };
}

/**
 * During a drag the board shows a FROZEN copy (so live updates can't move cards under the
 * cursor). A neighbour in that copy may have been deleted by someone else meanwhile; sending
 * its id would make the server answer 404. Drop such neighbours: the server then anchors on
 * the other one, or puts the card at the bottom.
 */
export function withLiveNeighbors(v: MoveVars, liveIds: ReadonlySet<string>): MoveVars {
  return {
    ...v,
    prevTaskId: v.prevTaskId && liveIds.has(v.prevTaskId) ? v.prevTaskId : null,
    nextTaskId: v.nextTaskId && liveIds.has(v.nextTaskId) ? v.nextTaskId : null,
  };
}

/** A rank FOR DISPLAY ONLY, so the card sorts into place before the server answers. */
export function provisionalRank(prev?: string, next?: string): string {
  try {
    return generateKeyBetween(prev ?? null, next ?? null);
  } catch {
    return prev ?? next ?? 'a0'; // odd neighbours: any value works, the server's rank replaces it
  }
}

/** The optimistic cache update: the card in its new column with a provisional rank. */
export function applyLocalMove(board: BoardResponse, v: MoveVars): BoardResponse {
  const byId = new Map(board.tasks.map((t) => [t.id, t]));
  const rank = provisionalRank(
    v.prevTaskId ? byId.get(v.prevTaskId)?.rank : undefined,
    v.nextTaskId ? byId.get(v.nextTaskId)?.rank : undefined,
  );
  return {
    ...board,
    tasks: board.tasks.map((t) => (t.id === v.taskId ? { ...t, columnId: v.toColumnId, rank } : t)),
  };
}

/** Rollback for ONE card (not the whole board), so a second in-flight drag isn't undone. */
export function restoreTask(
  board: BoardResponse,
  original: TaskCardDto | undefined,
): BoardResponse {
  if (!original) return board;
  return { ...board, tasks: board.tasks.map((t) => (t.id === original.id ? original : t)) };
}

/** The server's answer replaces our guess, unless a newer version already arrived (Day 15). */
export function applyServerTask(board: BoardResponse, task: TaskCardDto): BoardResponse {
  return {
    ...board,
    tasks: board.tasks.map((t) => (t.id === task.id && task.version >= t.version ? task : t)),
  };
}

/** For tests and assertions: a column's ids in board order. */
export const orderOf = (board: BoardResponse, columnId: string) =>
  board.tasks
    .filter((t) => t.columnId === columnId)
    .sort(byRank)
    .map((t) => t.id);
