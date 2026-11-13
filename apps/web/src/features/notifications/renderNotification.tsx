import type { ReactNode } from 'react';
import { isRole, type NotificationDto } from '@teamboard/shared';
import { ROLE_LABEL } from '@/lib/format';

const FIELD: Record<string, string> = { dueDate: 'due date', priority: 'priority' };

/** "MOB-12", or "a task" when the snapshot is missing. */
const taskOf = (n: NotificationDto): ReactNode =>
  n.data.projectKey && n.data.taskNumber ? (
    <b title={n.data.taskTitle}>
      {n.data.projectKey}-{n.data.taskNumber}
    </b>
  ) : (
    'a task'
  );

/**
 * The sentence after the actor's name. One case per NOTIFICATION_TYPES entry; a new type
 * without a sentence fails to compile at `never`.
 */
export function describeNotification(n: NotificationDto): ReactNode {
  const T = taskOf(n);
  switch (n.type) {
    case 'task.assigned':
      return <>assigned you {T}</>;
    case 'task.unassigned':
      return <>unassigned you from {T}</>;
    case 'comment.created':
      return (
        <>
          commented on {T}
          {n.data.excerpt && <>: “{n.data.excerpt}”</>}
        </>
      );
    case 'task.completed':
      return <>completed {T}</>;
    case 'task.updated': {
      const fields = (n.data.fields ?? []).map((f) => FIELD[f] ?? f);
      return (
        <>
          changed the {fields.length ? fields.join(' and ') : 'details'} of {T}
        </>
      );
    }
    case 'member.role_changed':
      return (
        <>
          changed your role to{' '}
          <b>{n.data.role && isRole(n.data.role) ? ROLE_LABEL[n.data.role] : 'a new role'}</b>
        </>
      );
    case 'invite.accepted':
      return <>joined using your invite</>;
    case 'ownership.transferred':
      return <>made you the Owner of this workspace</>;
    case 'sprint.started':
      return <>started {n.data.sprintName ?? 'a sprint'}</>;
    case 'sprint.completed':
      return <>completed {n.data.sprintName ?? 'a sprint'}</>;
    default: {
      const missing: never = n.type;
      return <>did something ({String(missing)})</>;
    }
  }
}

/** FR-NTF-07: where a click goes. Task notifications open the task; the rest stay put. */
export function notificationTarget(slug: string, n: NotificationDto): string | null {
  if (n.data.projectKey && n.data.taskNumber) {
    return `/w/${slug}/p/${n.data.projectKey}/tasks/${n.data.taskNumber}`;
  }
  if (n.type === 'member.role_changed' || n.type === 'ownership.transferred') {
    return `/w/${slug}/members`;
  }
  if (n.type === 'invite.accepted') return `/w/${slug}/members`;
  return null;
}

/** 99+ cap (FR-NTF-06). */
export const badgeText = (count: number) => (count > 99 ? '99+' : String(count));
