// Pure board-cache patchers for socket events (no React, no network), so they're unit-tested.
import type { BoardResponse, TaskCardDto } from '@teamboard/shared';

/** Does this task belong in this board view? (the sprint selector) */
export function inView(board: BoardResponse, t: TaskCardDto): boolean {
  switch (board.view) {
    case 'all':
      return true;
    case 'backlog':
      return t.sprintId === null;
    case 'active':
      return t.sprintId === (board.activeSprint?.id ?? null);
    default:
      return t.sprintId === board.view; // a specific sprint id
  }
}

/**
 * Insert / replace / remove one task, obeying the version rule (FR-RT-09): an event whose
 * version is not NEWER than the cached one is stale or a duplicate, and is ignored. That makes
 * out-of-order delivery and double delivery harmless, and keeps cards from duplicating.
 */
export function upsertTask(board: BoardResponse, t: TaskCardDto): BoardResponse {
  const existing = board.tasks.find((x) => x.id === t.id);
  if (existing && t.version <= existing.version) return board;
  if (!inView(board, t)) {
    // e.g. moved out of the viewed sprint: drop it from this view
    return existing ? { ...board, tasks: board.tasks.filter((x) => x.id !== t.id) } : board;
  }
  return {
    ...board,
    tasks: existing ? board.tasks.map((x) => (x.id === t.id ? t : x)) : [...board.tasks, t],
  };
}

export const removeTask = (board: BoardResponse, taskId: string): BoardResponse =>
  board.tasks.some((t) => t.id === taskId)
    ? { ...board, tasks: board.tasks.filter((t) => t.id !== taskId) }
    : board;

/** column:rebalanced: new ranks for one column; the server bumped each version by 1. */
export const applyRanks = (board: BoardResponse, ranks: Record<string, string>): BoardResponse => ({
  ...board,
  tasks: board.tasks.map((t) =>
    ranks[t.id] ? { ...t, rank: ranks[t.id]!, version: t.version + 1 } : t,
  ),
});

/**
 * comment:created / comment:deleted carry the task's NEW total: set it, don't add. No version
 * bump: the server didn't bump it either (a comment isn't a task edit).
 */
export const setCommentCount = (
  board: BoardResponse,
  taskId: string,
  commentCount: number,
): BoardResponse =>
  board.tasks.some((t) => t.id === taskId && t.commentCount !== commentCount)
    ? { ...board, tasks: board.tasks.map((t) => (t.id === taskId ? { ...t, commentCount } : t)) }
    : board;
