import type { Types } from 'mongoose';
import { ROLE_LEVEL, type Role } from '@teamboard/shared';

/**
 * Built once per request by resolveWorkspace. It is the ONLY source of workspaceId:
 * never trust a workspaceId from the body or query. Every service takes it first.
 */
export interface Ctx {
  userId: Types.ObjectId;
  workspaceId: Types.ObjectId;
  role: Role;
  roleLevel: number;
  tz: string; // workspace timezone (reports)
  now: () => Date; // injectable clock: tests and the seed script control time
  clientMutationId?: string | undefined; // echo suppression for real-time (Day 15)
}

export function makeCtx(p: Omit<Ctx, 'roleLevel' | 'now'> & { now?: () => Date }): Ctx {
  return { ...p, roleLevel: ROLE_LEVEL[p.role], now: p.now ?? (() => new Date()) };
}
