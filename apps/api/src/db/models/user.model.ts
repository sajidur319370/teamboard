import { Schema, model, type InferSchemaType } from 'mongoose';
import { PALETTE } from '@teamboard/shared';

// Global collection (not tenant-guarded). schema.md §4.
const userSchema = new Schema(
  {
    email: { type: String, required: true, lowercase: true, trim: true, maxlength: 254 },
    passwordHash: { type: String, required: true, select: false },
    name: { type: String, required: true, trim: true, minlength: 1, maxlength: 60 },
    avatarColor: { type: String, enum: PALETTE, default: 'blue' },
    timezone: { type: String, default: 'UTC' },
    lastWorkspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', default: null },
    passwordResetTokenHash: { type: String, default: null, select: false },
    passwordResetExpiresAt: { type: Date, default: null, select: false },
    passwordChangedAt: { type: Date, default: null },
  },
  { collection: 'users', timestamps: true, versionKey: false },
);

userSchema.index({ email: 1 }, { unique: true, name: 'uniq_email' });
userSchema.index(
  { passwordResetTokenHash: 1 },
  { partialFilterExpression: { passwordResetTokenHash: { $type: 'string' } } },
);

export type UserDoc = InferSchemaType<typeof userSchema>;
export const User = model('User', userSchema);
