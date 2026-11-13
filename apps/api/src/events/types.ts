import type { Types } from 'mongoose';
import type { ColumnDto, MemberDto, ProjectDto, Role, TaskCardDto } from '@teamboard/shared';

/**
 * What happened, in domain terms. Services emit these AFTER their transaction commits;
 * publish() decides who hears about it (sockets on Day 14, notifications on Day 17).
 * THIS UNION GROWS on later days (project.*, task.*, comment.*, sprint.*).
 */
export type DomainEvent =
  | { type: 'member.joined'; member: MemberDto; invitedBy: Types.ObjectId }
  | { type: 'member.roleChanged'; member: MemberDto; from: Role }
  | { type: 'member.removed'; userId: Types.ObjectId; reason: 'removed' | 'left' }
  | { type: 'ownership.transferred'; fromUserId: Types.ObjectId; toUserId: Types.ObjectId }
  | { type: 'workspace.deleted'; memberIds: Types.ObjectId[] }
  | {
      type: 'project.changed';
      kind: 'created' | 'updated' | 'archived' | 'unarchived' | 'deleted';
      project: ProjectDto;
    }
  | {
      type: 'columns.changed';
      kind: 'created' | 'updated' | 'deleted' | 'reordered';
      projectId: Types.ObjectId;
      columns: ColumnDto[]; // the full, ordered list (event catalog §12.2)
      movedTaskIds?: string[]; // column delete: tasks that moved to the target column
    }
  | { type: 'task.created'; projectId: Types.ObjectId; task: TaskCardDto; assignedIds: string[] }
  | {
      type: 'task.updated';
      projectId: Types.ObjectId;
      task: TaskCardDto;
      changedFields: string[];
      assignedIds: string[];
      unassignedIds: string[];
    }
  | { type: 'task.deleted'; projectId: Types.ObjectId; taskId: string; number: number }
  | {
      type: 'task.moved';
      projectId: Types.ObjectId;
      task: TaskCardDto;
      fromColumnId: string;
      completed: boolean;
    }
  | {
      type: 'column.rebalanced';
      projectId: Types.ObjectId;
      columnId: string;
      ranks: Record<string, string>; // taskId → new rank
    };

export type DomainEventType = DomainEvent['type'];
