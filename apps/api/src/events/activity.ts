import type { Types } from 'mongoose';
import type { ActivityAction } from '@teamboard/shared';
import type { Ctx } from '../types/ctx';

type EntityType = 'workspace' | 'membership' | 'invite' | 'project' | 'task' | 'comment' | 'sprint';

const ENTITY_BY_PREFIX: Record<string, EntityType> = {
  workspace: 'workspace',
  ownership: 'workspace',
  member: 'membership',
  invite: 'invite',
  project: 'project',
  column: 'project',
  task: 'task',
  comment: 'comment',
  sprint: 'sprint',
};

export interface ActivityRefs {
  projectId?: Types.ObjectId | null;
  taskId?: Types.ObjectId | null;
  sprintId?: Types.ObjectId | null;
  entityId?: Types.ObjectId;
}

/**
 * Builds an activity document. Insert it INSIDE the same transaction as the change it
 * describes, because reports are computed from it (database.md §6.3).
 */
export function activity(
  ctx: Ctx,
  action: ActivityAction,
  metadata: object = {},
  refs: ActivityRefs = {},
) {
  const entityType = ENTITY_BY_PREFIX[action.split('.')[0] ?? ''];
  if (!entityType) throw new Error(`No entity type for activity action "${action}"`);
  return {
    workspaceId: ctx.workspaceId,
    actorId: ctx.userId,
    action,
    entityType,
    entityId: refs.entityId ?? refs.taskId ?? refs.sprintId ?? refs.projectId ?? ctx.workspaceId,
    projectId: refs.projectId ?? null,
    taskId: refs.taskId ?? null,
    sprintId: refs.sprintId ?? null,
    metadata,
    createdAt: ctx.now(), // explicit, so the seed script can backdate history (Day 20)
  };
}
