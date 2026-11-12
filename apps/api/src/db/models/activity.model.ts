import { Schema, model, type InferSchemaType } from 'mongoose';
import { ACTIVITY_ACTIONS, ENTITY_TYPES } from '@teamboard/shared';
import { tenantGuard } from '../plugins/tenantGuard';

// Immutable event log (schema.md §13). Stored as data, rendered as sentences on the client.
// Feeds the activity feeds (Day 16) and the burndown report (Day 19).
const activitySchema = new Schema(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', default: null },
    taskId: { type: Schema.Types.ObjectId, ref: 'Task', default: null },
    sprintId: { type: Schema.Types.ObjectId, ref: 'Sprint', default: null },
    actorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    action: { type: String, enum: ACTIVITY_ACTIONS, required: true },
    entityType: { type: String, enum: ENTITY_TYPES, required: true },
    entityId: { type: Schema.Types.ObjectId, required: true },
    metadata: { type: Schema.Types.Mixed, default: {} },
  },
  {
    collection: 'activities',
    timestamps: { createdAt: true, updatedAt: false },
    versionKey: false,
  },
);

// Feeds (AP10)
activitySchema.index({ workspaceId: 1, createdAt: -1, _id: -1 });
activitySchema.index({ workspaceId: 1, projectId: 1, createdAt: -1, _id: -1 });
activitySchema.index({ workspaceId: 1, taskId: 1, createdAt: -1, _id: -1 });
// Burndown (AP12)
activitySchema.index({ workspaceId: 1, sprintId: 1, action: 1, createdAt: 1 });

// Immutable (invariant I13): block every update path.
activitySchema.pre(
  ['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'findOneAndReplace'],
  () => {
    throw new Error('activities are append-only');
  },
);

activitySchema.plugin(tenantGuard);
export type ActivityDoc = InferSchemaType<typeof activitySchema>;
export const Activity = model('Activity', activitySchema);
