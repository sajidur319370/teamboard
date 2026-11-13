import type { Types } from 'mongoose';
import type { ActivityAction, ActivityMetadataMap } from '@teamboard/shared';
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

/** One row ready to insert. `action` is widened so one array can hold several actions. */
export interface ActivityInsert {
  workspaceId: Types.ObjectId;
  actorId: Types.ObjectId;
  action: ActivityAction;
  entityType: EntityType;
  entityId: Types.ObjectId;
  projectId: Types.ObjectId | null;
  taskId: Types.ObjectId | null;
  sprintId: Types.ObjectId | null;
  metadata: object;
  createdAt: Date;
}

/**
 * Builds an activity document. Insert it INSIDE the same transaction as the change it
 * describes, because reports are computed from it (database.md §6.3).
 */
export function activity<A extends ActivityAction>(
  ctx: Ctx,
  action: A,
  metadata: ActivityMetadataMap[A], // typed per action: the web renders exactly these fields
  refs: ActivityRefs = {},
): ActivityInsert {
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
