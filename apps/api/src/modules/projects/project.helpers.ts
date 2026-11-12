import type { Types } from 'mongoose';
import { Membership, Project } from '../../db/models';
import { badRequest, conflict, notFound } from '../../lib/errors';
import type { Ctx } from '../../types/ctx';

/** Look a project up by key INSIDE the caller's workspace. Another tenant's key → 404. */
export async function findProject(ctx: Ctx, key: string) {
  const p = await Project.findOne({ workspaceId: ctx.workspaceId, key }).lean();
  if (!p) throw notFound();
  return p;
}

export type ProjectLean = Awaited<ReturnType<typeof findProject>>;

/** BR-11 / FR-PRJ-06: archived projects are read-only. */
export function assertWritable(p: { archivedAt?: Date | null }) {
  if (p.archivedAt) {
    throw conflict('PROJECT_ARCHIVED', 'This project is archived and cannot be changed.');
  }
}

/** I10 / FR-BRD-05: at least one `done` and one non-`done` column. */
export function assertBoardInvariant(columns: { category: string }[]) {
  const done = columns.filter((c) => c.category === 'done').length;
  if (done === 0 || done === columns.length) {
    throw conflict('BOARD_INVARIANT', 'A board needs at least one "done" and one other column.');
  }
}

/**
 * Compare-and-set filter: matches only if nobody changed the project since `p` was read
 * (every update bumps updatedAt). A miss means "the board changed": answer 409 RETRY.
 */
export const unchangedSince = (ctx: Ctx, p: { _id: Types.ObjectId; updatedAt: Date }) => ({
  _id: p._id,
  workspaceId: ctx.workspaceId,
  updatedAt: p.updatedAt,
});

export const boardChanged = () =>
  conflict('RETRY', 'The board changed while you were editing. Please try again.');

/** FR-PRJ-01: the lead must be a member of this workspace. */
export async function assertLead(ctx: Ctx, leadId: Types.ObjectId | null | undefined) {
  if (!leadId) return;
  const ok = await Membership.exists({ workspaceId: ctx.workspaceId, userId: leadId });
  if (!ok) throw badRequest('INVALID_LEAD', 'The project lead must be a member of this workspace.');
}

export const sameName = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
