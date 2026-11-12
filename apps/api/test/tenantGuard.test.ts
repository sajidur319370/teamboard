import express from 'express';
import { Types } from 'mongoose';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { Activity, Membership } from '../src/db/models';
import { activity } from '../src/events/activity';
import { errorHandler } from '../src/middleware/errorHandler';
import { makeCtx } from '../src/types/ctx';

describe('tenantGuard', () => {
  const wsId = new Types.ObjectId();
  const userId = new Types.ObjectId();

  it('throws on every query type without workspaceId', async () => {
    await expect(Membership.find({ userId })).rejects.toThrow(/Membership.find called without/);
    await expect(Membership.findById(new Types.ObjectId())).rejects.toThrow(/without workspaceId/);
    await expect(Membership.findOne({ userId })).rejects.toThrow(/without workspaceId/);
    await expect(Membership.countDocuments({ userId })).rejects.toThrow(/without workspaceId/);
    await expect(Membership.distinct('role', { userId })).rejects.toThrow(/without workspaceId/);
    await expect(Membership.updateMany({ userId }, { $set: { role: 'viewer' } })).rejects.toThrow(
      /without workspaceId/,
    );
    await expect(
      Membership.findOneAndUpdate({ userId }, { $set: { role: 'viewer' } }),
    ).rejects.toThrow(/without workspaceId/);
    await expect(Membership.deleteMany({ userId })).rejects.toThrow(/without workspaceId/);
    await expect(Membership.deleteOne({ userId })).rejects.toThrow(/without workspaceId/);
  });

  it('allows scoped queries', async () => {
    await Membership.create({ workspaceId: wsId, userId, role: 'member' });
    await expect(Membership.find({ workspaceId: wsId })).resolves.toHaveLength(1);
    await expect(
      Membership.findOne({ _id: { $exists: true }, workspaceId: wsId }),
    ).resolves.toBeTruthy();
    await expect(Membership.countDocuments({ workspaceId: wsId, userId })).resolves.toBe(1);
  });

  it('allows an explicit, named bypass', async () => {
    await expect(
      Membership.find({ userId }).setOptions({ skipTenantCheck: 'test' }),
    ).resolves.toEqual([]);
  });

  it('aggregations must start with $match on workspaceId', async () => {
    await expect(Membership.aggregate([{ $match: { role: 'owner' } }])).rejects.toThrow(
      /must start with/,
    );
    await expect(Membership.aggregate([{ $sort: { role: 1 } }])).rejects.toThrow(/must start with/);
    await expect(
      Membership.aggregate([{ $match: { workspaceId: wsId } }, { $count: 'n' }]),
    ).resolves.toEqual([]);
  });

  it('a guard violation inside a request is a generic 500 (a bug, never a leak)', async () => {
    const mini = express()
      .get('/x', async () => {
        await Membership.find({ userId });
      })
      .use(errorHandler);
    const res = await request(mini).get('/x');
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(res.body)).not.toContain('workspaceId');
  });
});

describe('activities', () => {
  const ctx = makeCtx({
    userId: new Types.ObjectId(),
    workspaceId: new Types.ObjectId(),
    role: 'owner',
    tz: 'UTC',
    now: () => new Date('2026-01-05T10:00:00Z'),
  });

  it('are append-only: every update path throws', async () => {
    const [doc] = await Activity.create([activity(ctx, 'workspace.created', { name: 'X' })]);
    const filter = { _id: doc!._id, workspaceId: ctx.workspaceId };
    await expect(Activity.updateOne(filter, { $set: { action: 'x' } })).rejects.toThrow(
      /append-only/,
    );
    await expect(Activity.findOneAndUpdate(filter, { $set: { metadata: {} } })).rejects.toThrow(
      /append-only/,
    );
    await expect(Activity.replaceOne(filter, {})).rejects.toThrow(/append-only/);
  });

  it('keep the createdAt from ctx.now(), so history can be backdated (seed script)', async () => {
    const [doc] = await Activity.create([activity(ctx, 'workspace.updated')]);
    expect(doc!.createdAt.toISOString()).toBe('2026-01-05T10:00:00.000Z');
  });

  it('map the action prefix to an entity type', () => {
    expect(activity(ctx, 'ownership.transferred').entityType).toBe('workspace');
    expect(activity(ctx, 'member.joined').entityType).toBe('membership');
    expect(activity(ctx, 'column.created').entityType).toBe('project');
  });
});
