import type { Types } from 'mongoose';
import { LIMITS, type LabelInput, type UpdateLabelInput } from '@teamboard/shared';
import { Project, Task } from '../../db/models';
import { withTransaction } from '../../db/transaction';
import { conflict, notFound } from '../../lib/errors';
import { publish } from '../../events/publish';
import type { Ctx } from '../../types/ctx';
import { assertWritable, boardChanged, findProject, sameName } from './project.helpers';
import { toLabelDto, toProjectDto } from './project.dto';

/** After a label change: publish the project so open boards refetch labels, return the list. */
async function labelsChanged(ctx: Ctx, projectId: Types.ObjectId) {
  const p = await Project.findOne({ _id: projectId, workspaceId: ctx.workspaceId }).lean();
  if (!p) throw notFound();
  await publish(ctx, [{ type: 'project.changed', kind: 'updated', project: toProjectDto(p) }]);
  return p.labels.map(toLabelDto);
}

/** FR-PRJ-08: max 30 labels per project, names unique ignoring case. */
export async function addLabel(ctx: Ctx, key: string, input: LabelInput) {
  const p = await findProject(ctx, key);
  assertWritable(p);
  if (p.labels.length >= LIMITS.labelsPerProject) {
    throw conflict('LABEL_LIMIT', `A project can have at most ${LIMITS.labelsPerProject} labels.`);
  }
  if (p.labels.some((l) => sameName(l.name, input.name))) {
    throw conflict('LABEL_NAME_TAKEN', 'A label with this name already exists.');
  }
  const res = await Project.updateOne(
    {
      _id: p._id,
      workspaceId: ctx.workspaceId,
      archivedAt: null,
      labels: { $size: p.labels.length },
    }, // CAS
    { $push: { labels: input } },
  );
  if (res.modifiedCount === 0) throw boardChanged();
  return labelsChanged(ctx, p._id);
}

export async function updateLabel(
  ctx: Ctx,
  key: string,
  labelId: Types.ObjectId,
  input: UpdateLabelInput,
) {
  const p = await findProject(ctx, key);
  assertWritable(p);
  const label = p.labels.find((l) => l._id.equals(labelId));
  if (!label) throw notFound();
  if (
    input.name !== undefined &&
    p.labels.some((l) => !l._id.equals(labelId) && sameName(l.name, input.name!))
  ) {
    throw conflict('LABEL_NAME_TAKEN', 'A label with this name already exists.');
  }
  const $set = {
    ...(input.name !== undefined && { 'labels.$[l].name': input.name }),
    ...(input.color !== undefined && { 'labels.$[l].color': input.color }),
  };
  if (Object.keys($set).length > 0) {
    await Project.updateOne(
      { _id: p._id, workspaceId: ctx.workspaceId },
      { $set },
      { arrayFilters: [{ 'l._id': labelId }] },
    );
  }
  return labelsChanged(ctx, p._id);
}

/** Removes the label from the project AND from every task that carries it, atomically. */
export async function deleteLabel(ctx: Ctx, key: string, labelId: Types.ObjectId) {
  const p = await findProject(ctx, key);
  assertWritable(p);
  if (!p.labels.some((l) => l._id.equals(labelId))) throw notFound();

  await withTransaction(async (session) => {
    await Project.updateOne(
      { _id: p._id, workspaceId: ctx.workspaceId },
      { $pull: { labels: { _id: labelId } } },
      { session },
    );
    await Task.updateMany(
      { workspaceId: ctx.workspaceId, projectId: p._id, labelIds: labelId },
      { $pull: { labelIds: labelId }, $inc: { version: 1 } },
      { session },
    );
  });
  return labelsChanged(ctx, p._id);
}
