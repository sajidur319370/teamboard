import { Schema, model, type InferSchemaType } from 'mongoose';
import { tenantGuard } from '../plugins/tenantGuard';

// schema.md §12. Hard-deleted (FR-CMT-03); removed with their task or project.
const commentSchema = new Schema(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, immutable: true },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true, immutable: true },
    taskId: { type: Schema.Types.ObjectId, ref: 'Task', required: true, immutable: true },
    authorId: { type: Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
    body: { type: String, required: true, trim: true, minlength: 1, maxlength: 5000 },
    editedAt: { type: Date, default: null },
  },
  { collection: 'comments', timestamps: true, versionKey: false },
);

// The task's thread, oldest first, keyset-paginated (AP9).
commentSchema.index({ workspaceId: 1, taskId: 1, createdAt: 1, _id: 1 });

commentSchema.plugin(tenantGuard);
export type CommentDoc = InferSchemaType<typeof commentSchema>;
export const Comment = model('Comment', commentSchema);
