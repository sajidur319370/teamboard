import type { Types } from 'mongoose';
import type { MemberDto, Role } from '@teamboard/shared';

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
  | { type: 'workspace.deleted'; memberIds: Types.ObjectId[] };

export type DomainEventType = DomainEvent['type'];
