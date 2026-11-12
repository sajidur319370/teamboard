import { Schema, model, type InferSchemaType } from 'mongoose';

// Global (per user). One document per refresh token; a login's chain of rotations
// shares a familyId. schema.md §5.
// A token is valid only if replacedByHash == null && revokedAt == null && expiresAt > now.
// A presented token with replacedByHash != null was stolen or replayed: revoke the whole family.
const sessionSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    familyId: { type: String, required: true }, // uuid v4, same across rotations
    tokenHash: { type: String, required: true }, // sha256(refreshToken)
    replacedByHash: { type: String, default: null }, // set when rotated
    revokedAt: { type: Date, default: null },
    userAgent: { type: String, maxlength: 300, default: '' },
    ip: { type: String, maxlength: 45, default: '' },
    expiresAt: { type: Date, required: true },
  },
  { collection: 'sessions', timestamps: { createdAt: true, updatedAt: false }, versionKey: false },
);

sessionSchema.index({ tokenHash: 1 }, { unique: true, name: 'uniq_token_hash' });
sessionSchema.index({ userId: 1 });
sessionSchema.index({ familyId: 1 });
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 }); // TTL

export type SessionDoc = InferSchemaType<typeof sessionSchema>;
export const Session = model('Session', sessionSchema);
