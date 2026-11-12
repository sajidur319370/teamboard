import { Schema, model, type InferSchemaType } from 'mongoose';
import { DATE_ONLY, LIMITS, PRIORITIES, STORY_POINTS } from '@teamboard/shared';
import { tenantGuard } from '../plugins/tenantGuard';

// Tasks (schema.md §11). Created now because column delete and category changes move tasks;
// the task endpoints arrive on Day 9.
const maxLen = (n: number) => ({
  validator: (arr: unknown[]) => arr.length <= n,
  message: `At most ${n} items`,
});

const taskSchema = new Schema(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, immutable: true },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true, immutable: true },
    number: { type: Number, required: true, min: 1, immutable: true },

    title: { type: String, required: true, trim: true, minlength: 1, maxlength: 200 },
    description: { type: String, maxlength: 10_000, default: '' }, // Markdown, rendered safely on the client

    columnId: { type: Schema.Types.ObjectId, required: true }, // → projects.columns._id
    rank: { type: String, required: true, maxlength: 200 }, // fractional index

    assigneeIds: {
      type: [{ type: Schema.Types.ObjectId, ref: 'User' }],
      default: [],
      validate: maxLen(LIMITS.assigneesPerTask),
    },
    reporterId: { type: Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
    watcherIds: {
      type: [{ type: Schema.Types.ObjectId, ref: 'User' }],
      default: [],
      validate: maxLen(LIMITS.watchersPerTask),
    },

    priority: { type: String, enum: PRIORITIES, default: 'none' },
    dueDate: { type: String, match: DATE_ONLY, default: null },
    labelIds: {
      type: [Schema.Types.ObjectId],
      default: [],
      validate: maxLen(LIMITS.labelsPerTask),
    },
    storyPoints: { type: Number, enum: [...STORY_POINTS, null], default: null },

    sprintId: { type: Schema.Types.ObjectId, ref: 'Sprint', default: null },
    completedAt: { type: Date, default: null }, // set iff the task is in a `done` column (BR-07)

    commentCount: { type: Number, default: 0, min: 0 },
    version: { type: Number, default: 1, min: 1 }, // real-time ordering (Day 15)
  },
  { collection: 'tasks', timestamps: true, versionKey: false },
);

// Uniqueness + deep links (AP7)
taskSchema.index(
  { workspaceId: 1, projectId: 1, number: 1 },
  { unique: true, name: 'uniq_task_number' },
);
// "All open tasks" board + move neighbors (AP5, AP6)
taskSchema.index({ workspaceId: 1, projectId: 1, columnId: 1, rank: 1 });
// Sprint board, backlog (sprintId: null), per-member report (AP4, AP13)
taskSchema.index({ workspaceId: 1, projectId: 1, sprintId: 1, columnId: 1, rank: 1 });
// My tasks (AP14): multikey on assigneeIds
taskSchema.index({ workspaceId: 1, assigneeIds: 1, completedAt: 1, dueDate: 1 });

taskSchema.plugin(tenantGuard);
export type TaskDoc = InferSchemaType<typeof taskSchema>;
export const Task = model('Task', taskSchema);

/** Fields sent on board load (keeps the payload small). The drawer loads the rest. */
export const CARD_FIELDS =
  '_id projectId number title columnId rank assigneeIds priority dueDate labelIds storyPoints sprintId completedAt commentCount version';
