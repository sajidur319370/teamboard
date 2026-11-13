import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  ACTIVITY_ACTIONS,
  type ActivityAction,
  type ActivityDto,
  type ActivityMetadataMap,
} from '@teamboard/shared';
import { describeActivity, mergeMoves, type RenderCtx } from './renderActivity';

const task = { key: 'MOB', number: 12, title: 'Fix login' };
const delta = { scopeDelta: { count: 1, points: 3 }, doneDelta: { count: 0, points: 0 } };
const sprint = { name: 'Sprint 5', number: 5 };

/** One realistic metadata per action. Typed as a full map: a new action breaks this file too. */
const SAMPLES: { [A in ActivityAction]: ActivityMetadataMap[A] } = {
  'workspace.created': { name: 'Acme' },
  'workspace.updated': { changes: { name: 'Acme Inc' } },
  'member.joined': { role: 'member' },
  'member.role_changed': { user: { id: 'u2', name: 'Rahim' }, from: 'member', to: 'viewer' },
  'member.removed': { user: { id: 'u2', name: 'Rahim' }, role: 'member' },
  'member.left': { role: 'member' },
  'ownership.transferred': { from: { id: 'u1', name: 'Olivia' }, to: { id: 'u3', name: 'Arif' } },
  'invite.created': { role: 'member' },
  'invite.revoked': { role: 'viewer' },
  'project.created': { name: 'Mobile', key: 'MOB' },
  'project.updated': { changes: ['name', 'leadId'], name: 'Mobile app', key: 'MOB' },
  'project.archived': { name: 'Mobile', key: 'MOB' },
  'project.unarchived': { name: 'Mobile', key: 'MOB' },
  'project.deleted': { name: 'Mobile', key: 'MOB' },
  'column.created': { name: 'QA', category: 'in_progress' },
  'column.renamed': { from: 'Review', to: 'QA' },
  'column.deleted': { name: 'QA', movedTo: 'Done', movedTasks: 2 },
  'column.reordered': { order: ['c1', 'c2'] },
  'task.created': { task, column: { columnId: 'c1', name: 'To Do' } },
  'task.updated': { task, field: 'priority', from: 'low', to: 'high' },
  'task.assigned': { task, user: { id: 'u2', name: 'Rahim' } },
  'task.unassigned': { task, user: { id: 'u2', name: 'Rahim' } },
  'task.moved': {
    task,
    from: { columnId: 'c2', name: 'In Progress' },
    to: { columnId: 'c3', name: 'Done' },
  },
  'task.completed': { task },
  'task.reopened': { task },
  'task.added_to_sprint': { task, sprint: { name: 'Sprint 5' }, ...delta },
  'task.removed_from_sprint': { task, sprint: { name: 'Sprint 5' }, ...delta },
  'task.deleted': { task },
  'comment.created': { task, excerpt: 'Fixed on staging' },
  'comment.deleted': { task },
  'sprint.created': { sprint },
  'sprint.started': { sprint },
  'sprint.completed': { sprint },
  'sprint.deleted': { sprint },
};

const make = <A extends ActivityAction>(
  action: A,
  metadata: ActivityMetadataMap[A],
  extra: Partial<ActivityDto> = {},
): ActivityDto =>
  ({
    id: `${action}-${Math.random()}`,
    action,
    metadata,
    actor: { id: 'u1', name: 'Olivia', avatarColor: 'blue' },
    projectId: 'p1',
    taskId: 't1',
    sprintId: null,
    createdAt: '2026-11-13T10:00:00.000Z',
    ...extra,
  }) as ActivityDto;

const NAMES = new Map([['u2', 'Rahim (current)']]);
const ctx: RenderCtx = {
  nameOf: (u) =>
    typeof u === 'string' ? (NAMES.get(u) ?? 'someone') : (u.name ?? NAMES.get(u.id) ?? 'someone'),
  task: (t) => `${t.key}-${t.number}`,
};
const text = (a: ActivityDto) =>
  renderToStaticMarkup(<>{describeActivity(a, ctx)}</>)
    .replace(/<[^>]+>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'");

describe('describeActivity (FR-ACT-05)', () => {
  it.each(ACTIVITY_ACTIONS)('%s renders a real sentence', (action) => {
    const s = text(make(action, SAMPLES[action] as never));
    expect(s.length).toBeGreaterThan(5);
    expect(s).not.toMatch(/did something|undefined|null|\[object/);
  });

  it.each([
    ['task.moved', 'moved MOB-12 from In Progress to Done'],
    ['task.updated', 'changed the priority of MOB-12 from Low to High'],
    ['task.assigned', 'assigned MOB-12 to Rahim'],
    ['comment.created', 'commented on MOB-12: “Fixed on staging”'],
    ['member.role_changed', 'changed Rahim’s role from Member to Viewer'],
    ['column.deleted', 'deleted the column “QA” and moved 2 tasks to “Done”'],
    ['workspace.updated', 'renamed the workspace to “Acme Inc”'],
    ['ownership.transferred', 'transferred ownership to Arif'],
  ] as const)('%s → "%s"', (action, expected) => {
    expect(text(make(action, SAMPLES[action] as never))).toBe(expected);
  });

  it('task.updated: every editable field has its own wording', () => {
    const upd = (field: string, from: unknown, to: unknown) =>
      text(make('task.updated', { task, field, from, to }));
    expect(upd('title', 'Old', 'Fix login')).toBe('renamed MOB-12 from “Old”');
    expect(text(make('task.updated', { task, field: 'description' }))).toBe(
      'updated the description of MOB-12',
    );
    expect(upd('dueDate', null, '2026-11-20')).toMatch(/^set the due date of MOB-12 to .*2026/);
    expect(upd('dueDate', '2026-11-20', null)).toBe('removed the due date of MOB-12');
    expect(upd('storyPoints', null, 5)).toBe('set the story points of MOB-12 to 5');
    expect(upd('storyPoints', 5, null)).toBe('cleared the story points of MOB-12');
    expect(upd('labelIds', [], ['l1'])).toBe('changed the labels on MOB-12');
  });

  it('rows written before name snapshots fall back to the current member name', () => {
    expect(text(make('task.assigned', { task, user: { id: 'u2' } }))).toBe(
      'assigned MOB-12 to Rahim (current)',
    );
    expect(text(make('ownership.transferred', { from: 'u1', to: 'u2' }))).toBe(
      'transferred ownership to Rahim (current)',
    );
    expect(text(make('member.removed', { user: { id: 'gone' }, role: 'member' }))).toBe(
      'removed someone from the workspace',
    );
    expect(text(make('comment.deleted', {}))).toBe('deleted a comment');
  });

  it('assigning yourself reads naturally', () => {
    expect(text(make('task.assigned', { task, user: { id: 'u1', name: 'Olivia' } }))).toBe(
      'assigned themselves to MOB-12',
    );
  });
});

describe('mergeMoves', () => {
  it('hides the completed/reopened line that came with a move (same actor, task, instant)', () => {
    const moved = make('task.moved', SAMPLES['task.moved']);
    const completed = make('task.completed', { task });
    const laterReopen = make('task.reopened', { task }, { createdAt: '2026-11-13T11:00:00.000Z' });
    const otherActor = make(
      'task.completed',
      { task },
      {
        actor: { id: 'u9', name: 'X', avatarColor: 'red' },
      },
    );
    expect(mergeMoves([completed, moved, laterReopen, otherActor])).toEqual([
      moved,
      laterReopen, // a category change completes/reopens WITHOUT a move: keep it
      otherActor,
    ]);
  });
});
