import type { Types } from 'mongoose';
import { rooms, type Envelope } from '@teamboard/shared';
import { Project } from '../db/models';
import type { DomainEvent } from '../events/types';
import type { Ctx } from '../types/ctx';
import { getIO } from './socket';

/**
 * Kick a user out of every room of a workspace, then tell them (FR-RT-11, AC-RT-03).
 * Their next REST call to that workspace is a 404 anyway; this stops the live stream.
 */
export async function revokeAccess(workspaceId: Types.ObjectId, userId: Types.ObjectId) {
  const io = getIO();
  if (!io) return;
  const projectIds = await Project.find({ workspaceId }).distinct('_id');
  io.in(rooms.user(String(userId))).socketsLeave([
    rooms.workspace(String(workspaceId)),
    ...projectIds.map((id) => rooms.board(String(id))),
  ]);
  io.to(rooms.user(String(userId))).emit('membership:revoked', {
    workspaceId: String(workspaceId),
  });
}

/**
 * Domain event → socket event(s), per the event catalog (requirement §12.2).
 * Runs from publish(), i.e. ONLY after the transaction committed (FR-RT-06), and always
 * sends the full entity (+ version for tasks) so clients patch their cache (FR-RT-07).
 */
export async function broadcast(ctx: Ctx, e: DomainEvent): Promise<void> {
  const io = getIO();
  if (!io) return;

  const base: Envelope = {
    workspaceId: String(ctx.workspaceId),
    actorId: String(ctx.userId),
    ...(ctx.clientMutationId && { clientMutationId: ctx.clientMutationId }),
    emittedAt: new Date().toISOString(),
  };
  const board = (projectId: Types.ObjectId | string) => io.to(rooms.board(String(projectId)));
  const workspace = () => io.to(rooms.workspace(String(ctx.workspaceId)));
  const user = (id: Types.ObjectId | string) => io.to(rooms.user(String(id)));

  switch (e.type) {
    case 'task.created':
      board(e.projectId).emit('task:created', {
        ...base,
        projectId: String(e.projectId),
        task: e.task,
      });
      break;
    case 'task.updated':
      board(e.projectId).emit('task:updated', {
        ...base,
        projectId: String(e.projectId),
        task: e.task,
        changedFields: e.changedFields,
      });
      break;
    case 'task.moved':
      board(e.projectId).emit('task:moved', {
        ...base,
        projectId: String(e.projectId),
        task: e.task,
        fromColumnId: e.fromColumnId,
      });
      break;
    case 'task.deleted':
      board(e.projectId).emit('task:deleted', {
        ...base,
        projectId: String(e.projectId),
        taskId: e.taskId,
        number: e.number,
      });
      break;

    case 'columns.changed': {
      const p = { ...base, projectId: String(e.projectId), columns: e.columns };
      const to = board(e.projectId);
      // One case per name: TypeScript checks each payload against its own event.
      switch (e.kind) {
        case 'created':
          to.emit('column:created', p);
          break;
        case 'updated':
          to.emit('column:updated', p);
          break;
        case 'reordered':
          to.emit('column:reordered', p);
          break;
        case 'deleted':
          to.emit('column:deleted', { ...p, movedTaskIds: e.movedTaskIds ?? [] });
          break;
      }
      break;
    }
    case 'column.rebalanced':
      board(e.projectId).emit('column:rebalanced', {
        ...base,
        projectId: String(e.projectId),
        columnId: e.columnId,
        ranks: e.ranks,
      });
      break;

    case 'project.changed': {
      const p = { ...base, projectId: e.project.id, project: e.project };
      // To the workspace (project lists) AND to the project's own open boards
      // (labels, archived banner, "this project was deleted").
      for (const to of [workspace(), board(e.project.id)]) {
        switch (e.kind) {
          case 'created':
            to.emit('project:created', p);
            break;
          case 'archived':
            to.emit('project:archived', p);
            break;
          case 'deleted':
            to.emit('project:deleted', p);
            break;
          case 'updated':
          case 'unarchived': // not in the catalog: clients just see the fresh project
            to.emit('project:updated', p);
            break;
        }
      }
      break;
    }

    case 'member.joined':
      workspace().emit('member:joined', { ...base, member: e.member });
      break;
    case 'member.roleChanged':
      workspace().emit('member:roleChanged', { ...base, member: e.member });
      user(e.member.userId).emit('membership:roleChanged', {
        workspaceId: base.workspaceId,
        role: e.member.role,
      }); // FR-RT-12: their UI changes without a reload
      break;
    case 'member.removed':
      await revokeAccess(ctx.workspaceId, e.userId);
      workspace().emit('member:removed', { ...base, userId: String(e.userId) });
      break;
    case 'ownership.transferred':
      user(e.fromUserId).emit('membership:roleChanged', {
        workspaceId: base.workspaceId,
        role: 'admin',
      });
      user(e.toUserId).emit('membership:roleChanged', {
        workspaceId: base.workspaceId,
        role: 'owner',
      });
      break;
    case 'workspace.deleted':
      await Promise.all(e.memberIds.map((id) => revokeAccess(ctx.workspaceId, id)));
      break;

    default: {
      // A compile error here = a new DomainEvent variant has no broadcast decision yet.
      const unhandled: never = e;
      return unhandled;
    }
  }
}
