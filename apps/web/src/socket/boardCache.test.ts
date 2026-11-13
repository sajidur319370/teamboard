import { describe, expect, it } from 'vitest';
import type { BoardResponse, TaskCardDto } from '@teamboard/shared';
import { applyRanks, inView, removeTask, setCommentCount, upsertTask } from './boardCache';

const card = (id: string, version = 1, extra: Partial<TaskCardDto> = {}): TaskCardDto => ({
  id,
  version,
  columnId: 'c1',
  rank: 'a0',
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
  ...extra,
});
const board = (
  tasks: TaskCardDto[],
  view: BoardResponse['view'] = 'all',
  activeSprintId?: string,
) =>
  ({
    view,
    tasks,
    activeSprint: activeSprintId ? { id: activeSprintId } : null,
  }) as unknown as BoardResponse;

describe('upsertTask (FR-RT-09 version rule)', () => {
  it('inserts a new task and replaces with a NEWER version', () => {
    const b = upsertTask(board([card('a')]), card('b'));
    expect(b.tasks.map((t) => t.id)).toEqual(['a', 'b']);
    const newer = upsertTask(b, card('a', 2, { title: 'renamed' }));
    expect(newer.tasks.find((t) => t.id === 'a')!.title).toBe('renamed');
  });

  it('ignores an older or equal version (out-of-order / duplicate delivery)', () => {
    const b = board([card('a', 3, { title: 'v3' })]);
    expect(upsertTask(b, card('a', 2, { title: 'v2' }))).toBe(b);
    expect(upsertTask(b, card('a', 3, { title: 'dup' }))).toBe(b);
  });

  it('many deliveries of the same create never duplicate a card', () => {
    let b = board([]);
    for (let i = 0; i < 5; i++) b = upsertTask(b, card('x'));
    expect(b.tasks).toHaveLength(1);
  });

  it('a task that leaves the current view is removed from it', () => {
    const b = board([card('a', 1, { sprintId: 's1' })], 'active', 's1');
    const moved = upsertTask(b, card('a', 2, { sprintId: null })); // back to the backlog
    expect(moved.tasks).toEqual([]);
    // ...and one that isn't in the view isn't added
    expect(upsertTask(board([], 'backlog'), card('z', 1, { sprintId: 's9' })).tasks).toEqual([]);
  });
});

describe('inView', () => {
  it.each([
    ['all', null, undefined, true],
    ['backlog', null, undefined, true],
    ['backlog', 's1', undefined, false],
    ['active', 's1', 's1', true],
    ['active', 's2', 's1', false],
    ['s7', 's7', undefined, true],
  ] as const)('view %s, task sprint %s → %s', (view, sprintId, active, expected) => {
    expect(inView(board([], view, active), card('t', 1, { sprintId }))).toBe(expected);
  });
});

describe('removeTask / applyRanks', () => {
  it('removes by id, returns the same board when absent', () => {
    const b = board([card('a'), card('b')]);
    expect(removeTask(b, 'a').tasks.map((t) => t.id)).toEqual(['b']);
    expect(removeTask(b, 'zz')).toBe(b);
  });

  it('applies rebalanced ranks and bumps versions like the server did', () => {
    const b = applyRanks(board([card('a', 4, { rank: 'a0VVVVV' }), card('b', 2)]), { a: 'a1' });
    expect(b.tasks[0]).toMatchObject({ rank: 'a1', version: 5 });
    expect(b.tasks[1]).toMatchObject({ rank: 'a0', version: 2 });
  });
});

describe('setCommentCount', () => {
  it('SETS the new total (a duplicate event is harmless) without bumping the version', () => {
    const b = board([card('a', 3), card('b')]);
    const once = setCommentCount(b, 'a', 4);
    expect(once.tasks[0]).toMatchObject({ commentCount: 4, version: 3 });
    expect(setCommentCount(once, 'a', 4)).toBe(once); // same total → same object
    expect(setCommentCount(b, 'zz', 1)).toBe(b);
  });
});
