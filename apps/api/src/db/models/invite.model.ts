import { Schema, model, type InferSchemaType } from 'mongoose';
import { INVITABLE_ROLES, LIMITS, type InviteStatus } from '@teamboard/shared';
import { tenantGuard } from '../plugins/tenantGuard';

// Invite links (schema.md §8). Only the SHA-256 hash of the token is stored (AC-INV-04).
const inviteSchema = new Schema(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, immutable: true },
    tokenHash: { type: String, required: true, immutable: true },
    role: { type: String, enum: INVITABLE_ROLES, required: true },
    email: { type: String, lowercase: true, trim: true, default: null }, // optional lock
    maxUses: { type: Number, min: 1, max: LIMITS.inviteMaxUses, default: 10 },
    uses: { type: Number, min: 0, default: 0 },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { collection: 'invites', timestamps: { createdAt: true, updatedAt: false }, versionKey: false },
);

inviteSchema.index({ tokenHash: 1 }, { unique: true, name: 'uniq_invite_token' });
inviteSchema.index({ workspaceId: 1, createdAt: -1 });
inviteSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 30 }); // gone 30 days after expiry

inviteSchema.plugin(tenantGuard);
export type InviteDoc = InferSchemaType<typeof inviteSchema>;
export const Invite = model('Invite', inviteSchema);

/** Status is DERIVED from the facts, never stored (data-model.md §9.2). Order matters. */
export function inviteStatus(
  i: Pick<InviteDoc, 'revokedAt' | 'expiresAt' | 'uses' | 'maxUses'>,
  now = new Date(),
): InviteStatus {
  if (i.revokedAt) return 'revoked';
  if (i.expiresAt <= now) return 'expired';
  if ((i.uses ?? 0) >= (i.maxUses ?? 10)) return 'used_up';
  return 'active';
}
