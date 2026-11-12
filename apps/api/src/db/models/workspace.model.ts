import { Schema, model, type InferSchemaType } from 'mongoose';
import { SLUG } from '@teamboard/shared';

// The tenant itself (schema.md §6). NOT tenant-guarded: its _id IS the workspaceId.
// Every lookup filters deletedAt: null. A soft-deleted workspace keeps its slug reserved
// until it is purged, so nobody can grab "acme" during the 30-day restore window.
const workspaceSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, minlength: 2, maxlength: 50 },
    slug: { type: String, required: true, lowercase: true, trim: true, match: SLUG },
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
    settings: {
      timezone: { type: String, default: 'UTC' },
      weekStartsOn: { type: Number, min: 0, max: 6, default: 1 }, // Monday
      workingDays: { type: [Number], default: [1, 2, 3, 4, 5] }, // 0 = Sunday
    },
    deletedAt: { type: Date, default: null },
  },
  { collection: 'workspaces', timestamps: true, versionKey: false },
);

workspaceSchema.index({ slug: 1 }, { unique: true, name: 'uniq_slug' });
workspaceSchema.index(
  { deletedAt: 1 },
  { partialFilterExpression: { deletedAt: { $type: 'date' } } }, // purge job
);

export type WorkspaceDoc = InferSchemaType<typeof workspaceSchema>;
export const Workspace = model('Workspace', workspaceSchema);
