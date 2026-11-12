import { describe, expect, it } from 'vitest';
import type { ProjectDto, TaskCardDto } from '@teamboard/shared';
import { byRank, groupByColumn } from './grouping';

const card = (id: string, columnId: string, rank: string): TaskCardDto => ({
  id,
  columnId,
  rank,
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
  version: 1,
});

describe('byRank', () => {
  it('compares by code unit like MongoDB, not by locale', () => {
    // localeCompare would put "a0v" before "a0V"; binary order puts uppercase first.
    const sorted = [card('1', 'c', 'a0v'), card('2', 'c', 'a0V'), card('3', 'c', 'a0')].sort(
      byRank,
    );
    expect(sorted.map((t) => t.rank)).toEqual(['a0', 'a0V', 'a0v']);
  });

  it('breaks rank ties by id', () => {
    const sorted = [card('b', 'c', 'a1'), card('a', 'c', 'a1')].sort(byRank);
    expect(sorted.map((t) => t.id)).toEqual(['a', 'b']);
  });
});

describe('groupByColumn', () => {
  const project = {
    columns: [
      { id: 'todo', name: 'To Do', category: 'todo', position: 0, wipLimit: null },
      { id: 'done', name: 'Done', category: 'done', position: 1, wipLimit: null },
    ],
  } as unknown as ProjectDto;

  it('puts every column in, sorted, and filters', () => {
    const tasks = [card('x', 'todo', 'a2'), card('y', 'todo', 'a1'), card('z', 'done', 'a0')];
    const cols = groupByColumn({ project, tasks });
    expect(cols.todo!.map((t) => t.id)).toEqual(['y', 'x']);
    expect(cols.done!.map((t) => t.id)).toEqual(['z']);
    expect(groupByColumn({ project, tasks }, (t) => t.id !== 'y').todo!.map((t) => t.id)).toEqual([
      'x',
    ]);
  });

  it('an empty board still has every column', () => {
    expect(groupByColumn({ project, tasks: [] })).toEqual({ todo: [], done: [] });
  });
});
