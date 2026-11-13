import { Schema, model, type InferSchemaType } from 'mongoose';
import { DATE_ONLY, SPRINT_STATES } from '@teamboard/shared';
import { tenantGuard } from '../plugins/tenantGuard';

// schema.md §10. planned → active → completed (data-model.md §9.1).

const scopeSnapshotSchema = new Schema(
  {
    taskIds: { type: [Schema.Types.ObjectId], default: [] },
    totalTasks: { type: Number, required: true },
    totalPoints: { type: Number, required: true },
    doneTasks: { type: Number, required: true }, // already done at start (D4)
    donePoints: { type: Number, required: true },
    takenAt: { type: Date, required: true },
  },
  { _id: false },
);

const burndownPointSchema = new Schema(
  {
    day: { type: String, required: true }, // YYYY-MM-DD, workspace tz
    scopeTasks: Number,
    scopePoints: Number,
    remainingTasks: Number,
    remainingPoints: Number,
    idealTasks: Number,
    idealPoints: Number,
  },
  { _id: false },
);

const memberStatSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, default: null }, // null = Unassigned
    name: String,
    tasks: Number,
    points: Number,
    isFormer: Boolean,
  },
  { _id: false },
);

const reportSchema = new Schema(
  {
    timezone: { type: String, required: true },
    summary: {
      committedTasks: Number,
      committedPoints: Number,
      addedTasks: Number,
      addedPoints: Number,
      removedTasks: Number,
      removedPoints: Number,
      completedTasks: Number,
      completedPoints: Number,
      carriedOverTasks: Number,
      carriedOverPoints: Number,
    },
    burndown: { type: [burndownPointSchema], default: [] },
    members: { type: [memberStatSchema], default: [] },
    generatedAt: { type: Date, required: true },
  },
  { _id: false },
);

const sprintSchema = new Schema(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, immutable: true },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true, immutable: true },
    number: { type: Number, required: true, immutable: true },
    name: { type: String, required: true, trim: true, minlength: 1, maxlength: 60 },
    goal: { type: String, maxlength: 500, default: '' },
    state: { type: String, enum: SPRINT_STATES, default: 'planned' },
    startDate: { type: String, required: true, match: DATE_ONLY },
    endDate: { type: String, required: true, match: DATE_ONLY },
    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    scopeSnapshot: { type: scopeSnapshotSchema, default: null },
    report: { type: reportSchema, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    /**
     * Bumped by lockSprint() (queries.md §10.1). A counter, not `$set: { updatedAt: now }`:
     * with an injected clock (tests, the seed script) two requests can set the SAME value,
     * and a write that changes nothing may not raise the conflict the lock exists for.
     */
    lock: { type: Number, default: 0 },
  },
  { collection: 'sprints', timestamps: true, versionKey: false },
);

sprintSchema.index({ workspaceId: 1, projectId: 1, state: 1, startDate: 1 });
sprintSchema.index(
  { workspaceId: 1, projectId: 1, number: 1 },
  { unique: true, name: 'uniq_sprint_number' },
);
// BR-08 / E18: the database, not the code, guarantees one active sprint per project.
sprintSchema.index(
  { projectId: 1 },
  {
    unique: true,
    partialFilterExpression: { state: 'active' },
    name: 'one_active_sprint_per_project',
  },
);

sprintSchema.plugin(tenantGuard);
export type SprintDoc = InferSchemaType<typeof sprintSchema>;
export const Sprint = model('Sprint', sprintSchema);
