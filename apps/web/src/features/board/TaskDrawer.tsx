import type { ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { ROLE_LEVEL, type UpdateTaskInput } from '@teamboard/shared';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { SafeMarkdown } from '@/components/SafeMarkdown';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ActivityFeed } from '@/features/activity/ActivityFeed';
import { CommentsSection } from '@/features/comments/CommentsSection';
import { useMe } from '@/features/auth/useMe';
import { useCan, useWorkspace } from '@/features/workspace/WorkspaceContext';
import { shortDate } from '@/lib/format';
import { useBoardCtx } from './BoardContext';
import { useDeleteTask, useTask, useUpdateTask } from './api';
import { DescriptionEditor } from './fields/DescriptionEditor';
import { AssigneesField, LabelsField } from './fields/PickerFields';
import { DueDateField, PointsField, PriorityField } from './fields/SelectFields';
import { TitleField } from './fields/TitleField';

/** FR-TSK-06: the task drawer. Rendered by the route …/tasks/:number over the board. */
export function TaskDrawer() {
  const { number = '' } = useParams();
  const { slug, projectKey, board, people, readOnly, boardPath } = useBoardCtx();
  const { role } = useWorkspace();
  const can = useCan();
  const myId = useMe().data?.user.id;
  const navigate = useNavigate();

  const task = useTask(slug, projectKey, Number(number));
  const update = useUpdateTask(slug, projectKey);
  const del = useDeleteTask(slug, projectKey);

  const close = () => navigate(boardPath);
  const save = (patch: UpdateTaskInput) => {
    if (!task.data) return Promise.resolve();
    const p = update.mutateAsync({ id: task.data.id, ...patch });
    // Field saves report their own errors; the description editor handles VERSION_CONFLICT.
    if (patch.expectedVersion === undefined) p.catch((e: Error) => toast.error(e.message));
    return p;
  };

  const t = task.data;
  const column = t && board.project.columns.find((c) => c.id === t.columnId);
  const reporter = t && people.get(t.reporterId);
  const mayDelete =
    !!t &&
    can('task:delete') &&
    !board.project.archivedAt &&
    (t.reporterId === myId || ROLE_LEVEL[role] >= ROLE_LEVEL.admin); // FR-TSK-05

  return (
    <Sheet open onOpenChange={(open) => !open && close()}>
      <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-2xl">
        {task.isPending && (
          <div className="space-y-3 p-6">
            <Skeleton className="h-6 w-24" />
            <Skeleton className="h-8 w-3/4" />
            <Skeleton className="h-40 w-full" />
          </div>
        )}
        {task.error && (
          <div className="space-y-3 p-6">
            <SheetTitle>Task not found</SheetTitle>
            <SheetDescription>This task doesn't exist, or it was deleted.</SheetDescription>
            <Button variant="outline" onClick={close}>
              Back to the board
            </Button>
          </div>
        )}
        {t && (
          <>
            <SheetHeader className="gap-1 pr-12">
              <span className="text-sm text-muted-foreground">
                {projectKey}-{t.number}
                {column && ` · ${column.name}`}
              </span>
              {/* Radix needs a title for screen readers; the editable title is right below. */}
              <SheetTitle className="sr-only">{t.title}</SheetTitle>
              <SheetDescription className="sr-only">Task details</SheetDescription>
              <TitleField
                key={t.id}
                value={t.title}
                readOnly={readOnly}
                onSave={(title) => void save({ title })}
              />
            </SheetHeader>

            <div className="grid grid-cols-[110px_1fr] items-center gap-x-3 gap-y-3 px-4 text-sm sm:grid-cols-[130px_1fr]">
              <Row label="Assignees">
                <AssigneesField
                  value={t.assigneeIds}
                  readOnly={readOnly}
                  onSave={(assigneeIds) => void save({ assigneeIds })}
                />
              </Row>
              <Row label="Priority">
                <PriorityField
                  value={t.priority}
                  readOnly={readOnly}
                  onSave={(priority) => void save({ priority })}
                />
              </Row>
              <Row label="Due date">
                <DueDateField
                  value={t.dueDate}
                  readOnly={readOnly}
                  onSave={(dueDate) => void save({ dueDate })}
                />
              </Row>
              <Row label="Labels">
                <LabelsField
                  value={t.labelIds}
                  readOnly={readOnly}
                  onSave={(labelIds) => void save({ labelIds })}
                />
              </Row>
              <Row label="Points">
                <PointsField
                  value={t.storyPoints}
                  readOnly={readOnly}
                  onSave={(storyPoints) => void save({ storyPoints })}
                />
              </Row>
              <Row label="Reporter">
                <span>
                  {reporter?.name ?? 'Unknown'} · created {shortDate(t.createdAt)}
                </span>
              </Row>
            </div>

            <section className="mt-6 px-4" aria-labelledby="desc-heading">
              <h3 id="desc-heading" className="mb-2 font-medium">
                Description
              </h3>
              {readOnly ? (
                <SafeMarkdown>{t.description || '_No description_'}</SafeMarkdown>
              ) : (
                <DescriptionEditor
                  key={t.id}
                  value={t.description}
                  version={t.version}
                  onSave={(description, expectedVersion) => save({ description, expectedVersion })}
                />
              )}
            </section>

            <Tabs defaultValue="comments" className="mt-6 px-4">
              <TabsList>
                <TabsTrigger value="comments">
                  Comments{t.commentCount > 0 && ` (${t.commentCount})`}
                </TabsTrigger>
                <TabsTrigger value="history">History</TabsTrigger>
              </TabsList>
              <TabsContent value="comments" className="pt-2">
                <CommentsSection
                  slug={slug}
                  projectKey={projectKey}
                  taskId={t.id}
                  archived={!!board.project.archivedAt}
                />
              </TabsContent>
              {/* Mounted only while open: Radix unmounts inactive tabs, so the feed loads on demand */}
              <TabsContent value="history" className="pt-2">
                <ActivityFeed slug={slug} filter={{ taskId: t.id }} linkTasks={false} />
              </TabsContent>
            </Tabs>

            {mayDelete && (
              <div className="mt-8 border-t px-4 py-4">
                <ConfirmDialog
                  trigger={
                    <Button variant="destructive" size="sm">
                      Delete task
                    </Button>
                  }
                  title={`Delete ${projectKey}-${t.number}?`}
                  description="The task and its comments are removed. Its number is never reused."
                  confirmLabel="Delete"
                  destructive
                  onConfirm={async () => {
                    await del.mutateAsync(t).catch((e: Error) => {
                      toast.error(e.message);
                      throw e;
                    });
                    toast.success(`${projectKey}-${t.number} deleted`);
                    close();
                  }}
                />
              </div>
            )}
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <span className="text-muted-foreground">{label}</span>
      <div className="min-w-0">{children}</div>
    </>
  );
}
