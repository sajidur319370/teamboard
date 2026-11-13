import { describe, expect, it } from 'vitest';
import type { BoardResponse, TaskCardDto } from '@teamboard/shared';
import type { Columns } from '../grouping';
import {
  applyLocalMove,
  applyServerTask,
  computeDrop,
  orderOf,
  previewMove,
  restoreTask,
  withLiveNeighbors,
} from './dropLogic';

const card = (id: string, columnId: string, rank: string, version = 1): TaskCardDto => ({
  id,
  columnId,
  rank,
  version,
  projectId: 'p',
  number: 1,
  title: id,
  assigneeIds: [],
  priority: 'none',
  dueDate: null,
  labelIds: [],
  storyPoints: null,
  sprintId: null,
  completedAt: null,
  commentCount: 0,
});

// To Do: A B C · Doing: D · Done: (empty)
const cols = (): Columns => ({
  todo: [card('A', 'todo', 'a0'), card('B', 'todo', 'a1'), card('C', 'todo', 'a2')],
  doing: [card('D', 'doing', 'a0')],
  done: [],
});

describe('computeDrop: exactly one request per real drop, none for drop-in-place', () => {
  it('dropped where it started → null (no PATCH at all)', () => {
    const c = cols();
    expect(computeDrop(c, c, 'B', 'B')).toBeNull();
  });

  it('reorder within a column: A dragged over C → after C', () => {
    const c = cols();
    expect(computeDrop(c, c, 'A', 'C')).toEqual({
      taskId: 'A',
      toColumnId: 'todo',
      prevTaskId: 'C',
      nextTaskId: null,
    });
  });

  it('reorder upwards: C dragged over A → top', () => {
    const c = cols();
    expect(computeDrop(c, c, 'C', 'A')).toEqual({
      taskId: 'C',
      toColumnId: 'todo',
      prevTaskId: null,
      nextTaskId: 'A',
    });
  });

  it('across columns: the hover preview places it, the drop reports its neighbours', () => {
    const start = cols();
    const preview = previewMove(start, 'B', 'D'); // hovering D in Doing → inserted above D
    expect(preview.doing!.map((t) => t.id)).toEqual(['B', 'D']);
    expect(preview.todo!.map((t) => t.id)).toEqual(['A', 'C']);
    // After the preview re-renders, the pointer is over the card's own slot.
    expect(computeDrop(start, preview, 'B', 'B')).toEqual({
      taskId: 'B',
      toColumnId: 'doing',
      prevTaskId: null,
      nextTaskId: 'D',
    });
  });

  it('into an EMPTY column (over = the column itself)', () => {
    const start = cols();
    const preview = previewMove(start, 'A', 'done');
    expect(preview.done!.map((t) => t.id)).toEqual(['A']);
    expect(computeDrop(start, preview, 'A', 'done')).toEqual({
      taskId: 'A',
      toColumnId: 'done',
      prevTaskId: null,
      nextTaskId: null,
    });
  });

  it('dragged to another column and back to the same spot → null', () => {
    const start = cols();
    const away = previewMove(start, 'B', 'D');
    const back = previewMove(away, 'B', 'C'); // over C in To Do → inserted above C, i.e. A B C
    expect(back.todo!.map((t) => t.id)).toEqual(['A', 'B', 'C']);
    expect(computeDrop(start, back, 'B', 'B')).toBeNull();
  });
});

describe('withLiveNeighbors', () => {
  it('drops neighbours that were deleted during the drag', () => {
    const v = { taskId: 'A', toColumnId: 'doing', prevTaskId: 'gone', nextTaskId: 'D' };
    expect(withLiveNeighbors(v, new Set(['A', 'D']))).toEqual({ ...v, prevTaskId: null });
    expect(withLiveNeighbors(v, new Set(['A', 'D', 'gone']))).toEqual(v);
  });
});

describe('previewMove', () => {
  it('returns the SAME object when nothing changes (no render loop)', () => {
    const c = cols();
    expect(previewMove(c, 'A', 'B')).toBe(c); // same column: dnd-kit's sortable animates it
    expect(previewMove(c, 'A', 'nope')).toBe(c);
  });
});

describe('optimistic cache updates', () => {
  const board = (): BoardResponse =>
    ({ tasks: [...cols().todo!, ...cols().doing!] }) as unknown as BoardResponse;

  it('applyLocalMove puts the card between its neighbours with a provisional rank', () => {
    const b = applyLocalMove(board(), {
      taskId: 'C',
      toColumnId: 'todo',
      prevTaskId: 'A',
      nextTaskId: 'B',
    });
    expect(orderOf(b, 'todo')).toEqual(['A', 'C', 'B']);
    const moved = applyLocalMove(board(), {
      taskId: 'A',
      toColumnId: 'doing',
      prevTaskId: 'D',
      nextTaskId: null,
    });
    expect(orderOf(moved, 'doing')).toEqual(['D', 'A']);
    expect(orderOf(moved, 'todo')).toEqual(['B', 'C']);
  });

  it('restoreTask rolls back only the failed card', () => {
    const original = board();
    const afterTwoDrags = applyLocalMove(
      applyLocalMove(original, {
        taskId: 'A',
        toColumnId: 'doing',
        prevTaskId: null,
        nextTaskId: null,
      }),
      { taskId: 'C', toColumnId: 'todo', prevTaskId: null, nextTaskId: 'B' },
    );
    const aFailed = restoreTask(
      afterTwoDrags,
      original.tasks.find((t) => t.id === 'A'),
    );
    expect(orderOf(aFailed, 'todo')).toEqual(['A', 'C', 'B']); // C's move survives
  });

  it('applyServerTask replaces the guess, but never with an older version', () => {
    const b = board();
    const server = { ...b.tasks[0]!, rank: 'Zz', version: 2 };
    expect(applyServerTask(b, server).tasks[0]!.rank).toBe('Zz');
    const stale = { ...b.tasks[0]!, rank: 'old', version: 0 };
    expect(applyServerTask(b, stale).tasks[0]!.rank).toBe('a0');
  });
});
