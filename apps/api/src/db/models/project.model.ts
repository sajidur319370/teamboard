import { Schema, model, type InferSchemaType } from 'mongoose';
import { COLUMN_CATEGORIES, LIMITS, PALETTE, PROJECT_KEY } from '@teamboard/shared';
import { tenantGuard } from '../plugins/tenantGuard';

// Projects with EMBEDDED columns and labels (schema.md §9, data-model.md §6):
// few items, always read together, and reordering is one atomic $set.
const columnSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, minlength: 1, maxlength: 30 },
    category: { type: String, enum: COLUMN_CATEGORIES, required: true },
    position: { type: Number, required: true, min: 0 }, // 0..n-1, rewritten on reorder
    wipLimit: { type: Number, min: 1, max: 100, default: null },
  },
  { _id: true },
);

const labelSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, minlength: 1, maxlength: 20 },
    color: { type: String, enum: PALETTE, required: true },
  },
  { _id: true },
);

const projectSchema = new Schema(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, immutable: true },
    name: { type: String, required: true, trim: true, minlength: 2, maxlength: 80 },
    key: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
      match: PROJECT_KEY,
      immutable: true, // task numbers (MOB-12) depend on it (BR-05)
    },
    description: { type: String, maxlength: 2000, default: '' },
    leadId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    columns: {
      type: [columnSchema],
      validate: {
        validator: (cols: unknown[]) => cols.length >= 2 && cols.length <= LIMITS.columnsPerProject,
        message: 'A project needs 2–15 columns',
      },
    },
    labels: {
      type: [labelSchema],
      default: [],
      validate: { validator: (l: unknown[]) => l.length <= LIMITS.labelsPerProject },
    },
    taskCounter: { type: Number, default: 0, min: 0 },
    sprintCounter: { type: Number, default: 0, min: 0 },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
    archivedAt: { type: Date, default: null },
  },
  { collection: 'projects', timestamps: true, versionKey: false },
);

projectSchema.index({ workspaceId: 1, key: 1 }, { unique: true, name: 'uniq_project_key' }); // I5
projectSchema.index({ workspaceId: 1, archivedAt: 1, name: 1 });

projectSchema.plugin(tenantGuard);
export type ProjectDoc = InferSchemaType<typeof projectSchema>;
export const Project = model('Project', projectSchema);

/** FR-PRJ-03: every new project starts with these. */
export const DEFAULT_COLUMNS = [
  { name: 'To Do', category: 'todo', position: 0 },
  { name: 'In Progress', category: 'in_progress', position: 1 },
  { name: 'Review', category: 'in_progress', position: 2 },
  { name: 'Done', category: 'done', position: 3 },
] as const;
