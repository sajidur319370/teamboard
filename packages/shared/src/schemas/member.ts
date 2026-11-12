import { z } from 'zod';
import { INVITABLE_ROLES, LIMITS } from '../constants';
import { emailSchema, objectIdSchema } from './common';

export const INVITE_EXPIRY_DAYS = [1, 3, 7, 30] as const;

export const createInviteSchema = z.object({
  role: z.enum(INVITABLE_ROLES), // never 'owner' (FR-INV-01)
  expiresInDays: z
    .union([z.literal(1), z.literal(3), z.literal(7), z.literal(30)], {
      error: 'Choose 1, 3, 7 or 30 days',
    })
    .default(7),
  maxUses: z.number().int().min(1).max(LIMITS.inviteMaxUses).default(10),
  email: emailSchema.nullish(), // optional email lock
});

export const changeRoleSchema = z.object({ role: z.enum(INVITABLE_ROLES) }); // nobody grants owner here
export const transferOwnershipSchema = z.object({
  userId: objectIdSchema,
  password: z.string().min(1, 'Required').max(72),
});
export const userIdParams = z.object({ userId: objectIdSchema });
export const inviteIdParams = z.object({ inviteId: objectIdSchema });
export const inviteTokenParams = z.object({ token: z.string().min(20).max(200) });

export type CreateInviteInput = z.infer<typeof createInviteSchema>;
export type CreateInviteForm = z.input<typeof createInviteSchema>;
export type ChangeRoleInput = z.infer<typeof changeRoleSchema>;
export type TransferOwnershipInput = z.infer<typeof transferOwnershipSchema>;
