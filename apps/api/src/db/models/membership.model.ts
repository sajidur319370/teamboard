import { Schema, model, type InferSchemaType } from 'mongoose';
import { ROLES } from '@teamboard/shared';
import { tenantGuard } from '../plugins/tenantGuard';

// User ↔ workspace + role (schema.md §7). Tenant-owned.
const membershipSchema = new Schema(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, immutable: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
    role: { type: String, enum: ROLES, required: true },
    invitedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    inviteId: { type: Schema.Types.ObjectId, ref: 'Invite', default: null },
    joinedAt: { type: Date, default: Date.now },
  },
  { collection: 'memberships', timestamps: true, versionKey: false },
);

membershipSchema.index({ workspaceId: 1, userId: 1 }, { unique: true, name: 'uniq_member' }); // AP2, I3
membershipSchema.index({ userId: 1 }); // AP3: list my workspaces (bypass 'list-my-workspaces')
membershipSchema.index(
  { workspaceId: 1 },
  { unique: true, partialFilterExpression: { role: 'owner' }, name: 'one_owner_per_workspace' }, // I4
);

membershipSchema.plugin(tenantGuard); // must run BEFORE model()
export type MembershipDoc = InferSchemaType<typeof membershipSchema>;
export const Membership = model('Membership', membershipSchema);
