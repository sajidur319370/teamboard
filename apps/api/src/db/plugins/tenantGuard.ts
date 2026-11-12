// Safety net for tenant isolation (schema.md §3). Applied to every TENANT-OWNED schema.
// If a query on a tenant model has no workspaceId in its filter, it throws instead of leaking data.
import type {
  Aggregate,
  MongooseDefaultQueryMiddleware,
  PipelineStage,
  Query,
  Schema,
} from 'mongoose';

declare module 'mongoose' {
  interface QueryOptions {
    /**
     * Reason string for an approved bypass (data-model.md §2.3). Approved reasons:
     * 'list-my-workspaces', 'workspace-limit', 'invite-token-lookup', plus system jobs.
     */
    skipTenantCheck?: string;
  }
}

export class TenantScopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TenantScopeError';
  }
}

const GUARDED_QUERY_OPS: MongooseDefaultQueryMiddleware[] = [
  'find',
  'findOne',
  'findOneAndUpdate',
  'findOneAndDelete',
  'findOneAndReplace',
  'updateOne',
  'updateMany',
  'replaceOne',
  'deleteOne',
  'deleteMany',
  'countDocuments',
  'distinct', // not in schema.md's list, but it reads tenant data just the same
];

export function tenantGuard(schema: Schema): void {
  schema.pre(GUARDED_QUERY_OPS, function (this: Query<unknown, unknown>) {
    if (this.getOptions().skipTenantCheck) return;
    if (this.getFilter().workspaceId == null) {
      const op = (this as unknown as { op?: string }).op ?? 'query'; // runtime field, not in the types
      throw new TenantScopeError(`${this.model.modelName}.${op} called without workspaceId`);
    }
  });

  // Aggregations must START with a $match on workspaceId. No bypass for aggregates.
  schema.pre('aggregate', function (this: Aggregate<unknown>) {
    const first = this.pipeline()[0] as PipelineStage | undefined;
    if (!first || !('$match' in first) || first.$match.workspaceId == null) {
      throw new TenantScopeError(
        `${this.model().modelName}.aggregate must start with { $match: { workspaceId } }`,
      );
    }
  });
}
