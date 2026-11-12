import { generateKeyBetween } from 'fractional-indexing';
import { Types } from 'mongoose';
import type { ProjectDto, WorkspaceDto } from '@teamboard/shared';
import { Project, Task } from '../../src/db/models';

const oid = (id: string) => new Types.ObjectId(id);

/**
 * Inserts a task straight into the DB at the bottom of `columnId` (task endpoints arrive on
 * Day 9). Uses the project's real counter and valid fractional ranks, like the service will.
 */
export async function insertTask(
  ws: WorkspaceDto,
  project: ProjectDto,
  columnId: string,
  reporterId: string,
  extra: { title?: string; completedAt?: Date | null; labelIds?: string[] } = {},
) {
  const workspaceId = oid(ws.id);
  const projectId = oid(project.id);
  const counter = await Project.findOneAndUpdate(
    { _id: projectId, workspaceId },
    { $inc: { taskCounter: 1 } },
    { returnDocument: 'after' },
  ).lean();
  const last = await Task.findOne({ workspaceId, projectId, columnId: oid(columnId) })
    .sort({ rank: -1 })
    .select('rank')
    .lean();
  const number = counter!.taskCounter;
  return Task.create({
    workspaceId,
    projectId,
    number,
    title: extra.title ?? `Task ${number}`,
    columnId: oid(columnId),
    rank: generateKeyBetween(last?.rank ?? null, null),
    reporterId: oid(reporterId),
    completedAt: extra.completedAt ?? null,
    labelIds: (extra.labelIds ?? []).map(oid),
  });
}

/** The tasks of a column, in board order. */
export async function tasksIn(ws: WorkspaceDto, project: ProjectDto, columnId: string) {
  return Task.find({
    workspaceId: oid(ws.id),
    projectId: oid(project.id),
    columnId: oid(columnId),
  })
    .sort({ rank: 1 })
    .lean();
}
