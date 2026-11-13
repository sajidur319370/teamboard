import { Schema, model, type InferSchemaType } from 'mongoose';
import { NOTIFICATION_TYPES } from '@teamboard/shared';
import { tenantGuard } from '../plugins/tenantGuard';

/** FR-NTF-09: 90 days, then MongoDB's TTL monitor deletes them (checked about once a minute). */
export const NOTIFICATION_TTL_SEC = 60 * 60 * 24 * 90;

// schema.md §14. Written AFTER the commit (a lost notification is acceptable, a lost
// activity isn't), from domain events, never by the client (FR-NTF-01).
const notificationSchema = new Schema(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true }, // recipient
    type: { type: String, enum: NOTIFICATION_TYPES, required: true },
    actorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', default: null },
    taskId: { type: Schema.Types.ObjectId, ref: 'Task', default: null },
    sprintId: { type: Schema.Types.ObjectId, ref: 'Sprint', default: null },
    data: { type: Schema.Types.Mixed, default: {} }, // render snapshot
    readAt: { type: Date, default: null },
  },
  {
    collection: 'notifications',
    timestamps: { createdAt: true, updatedAt: false },
    versionKey: false,
  },
);

// Unread list + unread count + mark all read (AP11)
notificationSchema.index({ userId: 1, workspaceId: 1, readAt: 1, createdAt: -1 });
// "All notifications" sorted by date (readAt above would force an in-memory sort)
notificationSchema.index({ userId: 1, workspaceId: 1, createdAt: -1 });
// Cascade deletes: a task, a project
notificationSchema.index({ workspaceId: 1, taskId: 1 });
notificationSchema.index({ workspaceId: 1, projectId: 1 });
// Auto-delete after 90 days
notificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: NOTIFICATION_TTL_SEC });

notificationSchema.plugin(tenantGuard);
export type NotificationDoc = InferSchemaType<typeof notificationSchema>;
export const Notification = model('Notification', notificationSchema);
