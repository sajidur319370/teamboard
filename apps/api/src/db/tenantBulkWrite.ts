import type { ClientSession, Model } from 'mongoose';
import type { Ctx } from '../types/ctx';

export type TenantUpdateOp = {
  updateOne: { filter: Record<string, unknown>; update: Record<string, unknown> };
};

/** Any tenant model: only bulkWrite is used, so we don't need Mongoose's heavy generics. */
type BulkWritable = Pick<Model<unknown>, 'bulkWrite'>;

/**
 * bulkWrite() skips query middleware, so the tenant guard can't see it (schema.md §3).
 * This is the ONLY allowed way to bulk-write tenant data: it forces ctx.workspaceId into
 * every filter, overriding anything the caller passed (queries.md §1.4).
 */
export async function tenantBulkWrite(
  ctx: Ctx,
  model: BulkWritable,
  ops: TenantUpdateOp[],
  options: { session?: ClientSession } = {},
) {
  if (ops.length === 0) return;
  const scoped = ops.map(({ updateOne }) => ({
    updateOne: { ...updateOne, filter: { ...updateOne.filter, workspaceId: ctx.workspaceId } },
  }));
  return model.bulkWrite(scoped as Parameters<BulkWritable['bulkWrite']>[0], {
    ordered: true,
    ...options,
  });
}
