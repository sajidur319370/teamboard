import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { NOTIFICATION_TYPES, type NotificationDto } from '@teamboard/shared';
import { badgeText, describeNotification, notificationTarget } from './renderNotification';

const make = (
  type: NotificationDto['type'],
  data: NotificationDto['data'] = {},
): NotificationDto => ({
  id: 'n1',
  type,
  actor: { id: 'u1', name: 'Sajid', avatarColor: 'blue' },
  projectId: 'p1',
  taskId: 't1',
  data,
  readAt: null,
  createdAt: '2026-11-13T10:00:00.000Z',
});
const task = { projectKey: 'MOB', taskNumber: 12, taskTitle: 'Fix login' };
const text = (n: NotificationDto) =>
  renderToStaticMarkup(<>{describeNotification(n)}</>).replace(/<[^>]+>/g, '');

describe('describeNotification', () => {
  it.each(NOTIFICATION_TYPES)('%s has a sentence', (type) => {
    const s = text(make(type, { ...task, role: 'admin', excerpt: 'hi', sprintName: 'Sprint 5' }));
    expect(s.length).toBeGreaterThan(5);
    expect(s).not.toMatch(/did something|undefined|null/);
  });

  it.each([
    ['task.assigned', task, 'assigned you MOB-12'],
    [
      'comment.created',
      { ...task, excerpt: 'Fixed on staging' },
      'commented on MOB-12: “Fixed on staging”',
    ],
    ['member.role_changed', { role: 'admin' }, 'changed your role to Admin'],
    ['invite.accepted', { role: 'member' }, 'joined using your invite'],
    [
      'task.updated',
      { ...task, fields: ['dueDate', 'priority'] },
      'changed the due date and priority of MOB-12',
    ],
  ] as const)('%s', (type, data, expected) => {
    expect(text(make(type, data as NotificationDto['data']))).toBe(expected);
  });

  it('a missing task snapshot reads "a task"', () => {
    expect(text(make('task.completed'))).toBe('completed a task');
  });
});

describe('notificationTarget (FR-NTF-07) / badge (FR-NTF-06)', () => {
  it('task notifications open the task; member news opens Members', () => {
    expect(notificationTarget('acme', make('task.assigned', task))).toBe('/w/acme/p/MOB/tasks/12');
    expect(notificationTarget('acme', make('member.role_changed', { role: 'viewer' }))).toBe(
      '/w/acme/members',
    );
    expect(notificationTarget('acme', make('sprint.started', { sprintName: 'S1' }))).toBeNull();
  });

  it('caps the badge at 99+', () => {
    expect([1, 99, 100, 5000].map(badgeText)).toEqual(['1', '99', '99+', '99+']);
  });
});
