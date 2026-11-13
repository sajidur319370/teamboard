import type { Types } from 'mongoose';
import type { NotificationData } from '@teamboard/shared';
import { Project, Task } from '../db/models';
import { subscribe } from '../events/publish';
import type { DomainEvent } from '../events/types';
import { oid } from '../lib/ids';
import { excerpt } from '../lib/text';
import type { Ctx } from '../types/ctx';
import { notify, type NotifyItem } from './notify';

/** The task as it is NOW (after the commit), plus its render snapshot. */
async function taskInfo(ctx: Ctx, taskId: string) {
  const t = await Task.findOne({ _id: oid(taskId), workspaceId: ctx.workspaceId })
    .select('number title projectId reporterId watcherIds assigneeIds')
    .lean();
  if (!t) return null; // deleted in the meantime: nothing to point at
  const p = await Project.findOne({ _id: t.projectId, workspaceId: ctx.workspaceId })
    .select('key')
    .lean();
  const data: NotificationData = {
    ...(p && { projectKey: p.key }),
    taskNumber: t.number,
    taskTitle: t.title,
  };
  return { t, base: { data, projectId: t.projectId, taskId: t._id } };
}

const ids = (a: (Types.ObjectId | string)[]) => a.map(String);

/** Requirement §14.1: which event notifies whom. Items are listed in priority order. */
export async function itemsFor(ctx: Ctx, e: DomainEvent): Promise<NotifyItem[]> {
  switch (e.type) {
    case 'task.created':
    case 'task.updated': {
      const changed =
        e.type === 'task.updated'
          ? (['dueDate', 'priority'] as const).filter((f) => e.changedFields.includes(f))
          : [];
      const unassigned = e.type === 'task.updated' ? e.unassignedIds : [];
      if (!e.assignedIds.length && !unassigned.length && !changed.length) return []; // no read
      const info = await taskInfo(ctx, e.task.id);
      if (!info) return [];
      const { base } = info;
      return [
        ...e.assignedIds.map((userId) => ({ ...base, userId, type: 'task.assigned' as const })), // N1
        ...unassigned.map((userId) => ({ ...base, userId, type: 'task.unassigned' as const })), // N2
        ...(changed.length
          ? e.task.assigneeIds.map((userId) => ({
              ...base,
              data: { ...base.data, fields: changed },
              userId,
              type: 'task.updated' as const,
            }))
          : []), // N5
      ];
    }
    case 'task.moved': {
      if (!e.intoDone) return []; // only the move INTO done, not a reorder inside it
      const info = await taskInfo(ctx, e.task.id);
      if (!info) return [];
      return ids([info.t.reporterId, ...info.t.watcherIds]).map((userId) => ({
        ...info.base,
        userId,
        type: 'task.completed' as const,
      })); // N4
    }
    case 'comment.created': {
      const data: NotificationData = {
        projectKey: e.task.key,
        taskNumber: e.task.number,
        taskTitle: e.task.title,
        excerpt: excerpt(e.comment.body),
      };
      return e.watcherIds.map((userId) => ({
        userId,
        type: 'comment.created' as const,
        data,
        projectId: e.projectId,
        taskId: oid(e.taskId),
      })); // N3: reporter, assignees, earlier commenters
    }
    case 'sprint.changed': {
      if (e.kind !== 'started' && e.kind !== 'completed') return [];
      const data: NotificationData = {
        sprintName: e.sprint.name,
        ...(e.projectKey && { projectKey: e.projectKey }),
      };
      return (e.assigneeIds ?? []).map((userId) => ({
        userId,
        type: e.kind === 'started' ? ('sprint.started' as const) : ('sprint.completed' as const),
        data,
        projectId: e.projectId,
        sprintId: oid(e.sprint.id),
      })); // N9: assignees of the sprint's tasks
    }
    case 'member.roleChanged':
      return [
        { userId: e.member.userId, type: 'member.role_changed', data: { role: e.member.role } },
      ]; // N6
    case 'member.joined':
      return [
        { userId: String(e.invitedBy), type: 'invite.accepted', data: { role: e.member.role } },
      ]; // N7
    case 'ownership.transferred':
      return [{ userId: String(e.toUserId), type: 'ownership.transferred', data: {} }]; // N8
    default:
      return []; // other events don't notify (removal = the membership:revoked toast, FR-NTF-13)
  }
}

export async function notifyFromEvent(ctx: Ctx, e: DomainEvent): Promise<void> {
  const items = await itemsFor(ctx, e);
  if (items.length) await notify(ctx, items);
}

let started = false;
/** Plug the notifier into publish(), once per process (createApp may run several times in tests). */
export function startNotifier() {
  if (started) return;
  started = true;
  subscribe(notifyFromEvent);
}
