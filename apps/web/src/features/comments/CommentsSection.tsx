import { useState, type FormEvent, type KeyboardEvent } from 'react';
import { toast } from 'sonner';
import { ROLE_LEVEL, type CommentDto } from '@teamboard/shared';
import { ApiError } from '@/api/client';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { SafeMarkdown } from '@/components/SafeMarkdown';
import { UserAvatar } from '@/components/UserAvatar';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { useMe } from '@/features/auth/useMe';
import { useCan, useWorkspace } from '@/features/workspace/WorkspaceContext';
import { relativeTime } from '@/lib/format';
import { flattenComments } from '@/socket/commentsCache';
import { useAddComment, useComments, useDeleteComment, useEditComment } from './api';

const MAX = 5000;

/** ⌘/Ctrl+Enter submits, like most comment boxes. */
const submitOnModEnter = (e: KeyboardEvent<HTMLTextAreaElement>) => {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
    e.preventDefault();
    e.currentTarget.form?.requestSubmit();
  }
};

/** FR-CMT-01..07: the task's thread, live (Day 15 socket), inside the drawer. */
export function CommentsSection(props: {
  slug: string;
  projectKey: string;
  taskId: string;
  archived: boolean;
}) {
  const { slug, projectKey, taskId, archived } = props;
  const can = useCan();
  const comments = useComments(slug, taskId);
  const add = useAddComment(slug, projectKey, taskId);
  const [draft, setDraft] = useState('');
  const all = flattenComments(comments.data);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const body = draft.trim();
    if (!body || add.isPending) return;
    add.mutate(body, {
      onSuccess: () => setDraft(''),
      onError: (err) =>
        toast.error(
          err instanceof ApiError && err.status === 404
            ? 'This task was deleted. Your text is still in the box.' // E2: never lose the text
            : err.message,
        ),
    });
  };

  return (
    <section aria-label="Comments" className="space-y-4">
      {comments.isPending && <Skeleton className="h-16 w-full" />}
      {comments.error && <p className="text-sm text-destructive">{comments.error.message}</p>}
      {comments.data && all.length === 0 && (
        <p className="text-sm text-muted-foreground">No comments yet.</p>
      )}

      <ol className="space-y-4">
        {all.map((c) => (
          <CommentItem key={c.id} c={c} {...props} />
        ))}
      </ol>

      {comments.hasNextPage && (
        <Button
          variant="outline"
          size="sm"
          disabled={comments.isFetchingNextPage}
          onClick={() => void comments.fetchNextPage()}
        >
          {comments.isFetchingNextPage ? 'Loading…' : 'Load more comments'}
        </Button>
      )}

      {can('comment:create') && !archived && (
        <form onSubmit={submit} className="space-y-2">
          <Textarea
            aria-label="Write a comment"
            placeholder="Write a comment… Markdown works: **bold**, `code`, [links](https://…)"
            value={draft}
            maxLength={MAX}
            rows={3}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={submitOnModEnter}
          />
          <div className="flex items-center justify-end gap-3">
            {draft.length > MAX * 0.9 && (
              <span className="text-xs text-muted-foreground">
                {draft.length}/{MAX}
              </span>
            )}
            <Button type="submit" size="sm" disabled={!draft.trim() || add.isPending}>
              {add.isPending ? 'Posting…' : 'Comment'}
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}

function CommentItem(props: {
  c: CommentDto;
  slug: string;
  projectKey: string;
  taskId: string;
  archived: boolean;
}) {
  const { c, slug, projectKey, taskId, archived } = props;
  const myId = useMe().data?.user.id;
  const { role } = useWorkspace();
  const can = useCan();
  const edit = useEditComment(slug, taskId);
  const del = useDeleteComment(slug, projectKey, taskId);
  const [editing, setEditing] = useState<string | null>(null); // the draft, or null

  const mine = c.author.id === myId;
  const mayEdit = !archived && mine && can('comment:update'); // author only (FR-CMT-02)
  const mayDelete =
    !archived && can('comment:delete') && (mine || ROLE_LEVEL[role] >= ROLE_LEVEL.admin);

  const save = (e: FormEvent) => {
    e.preventDefault();
    const body = editing?.trim();
    if (!body) return;
    if (body === c.body) return setEditing(null);
    edit.mutate(
      { id: c.id, body },
      {
        onSuccess: () => setEditing(null),
        onError: (err) => toast.error(err.message), // the draft stays open
      },
    );
  };

  return (
    <li className="flex gap-3">
      <UserAvatar name={c.author.name} color={c.author.avatarColor} className="mt-0.5 size-7" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
          <span className="font-medium">{c.author.name}</span>
          <time
            dateTime={c.createdAt}
            title={new Date(c.createdAt).toLocaleString()}
            className="text-xs text-muted-foreground"
          >
            {relativeTime(c.createdAt)}
          </time>
          {c.editedAt && (
            <span
              className="text-xs text-muted-foreground"
              title={`Edited ${new Date(c.editedAt).toLocaleString()}`}
            >
              (edited)
            </span>
          )}
          {(mayEdit || mayDelete) && editing === null && (
            <span className="ml-auto flex gap-1">
              {mayEdit && (
                <Button variant="ghost" size="xs" onClick={() => setEditing(c.body)}>
                  Edit
                </Button>
              )}
              {mayDelete && (
                <ConfirmDialog
                  trigger={
                    <Button variant="ghost" size="xs" className="text-destructive">
                      Delete
                    </Button>
                  }
                  title="Delete this comment?"
                  description={
                    mine
                      ? 'It is removed for everyone.'
                      : `${c.author.name}'s comment is removed for everyone.`
                  }
                  confirmLabel="Delete"
                  destructive
                  onConfirm={() =>
                    del.mutateAsync(c.id).catch((e: Error) => {
                      toast.error(e.message);
                      throw e;
                    })
                  }
                />
              )}
            </span>
          )}
        </div>

        {editing === null ? (
          <SafeMarkdown className="mt-1 text-sm">{c.body}</SafeMarkdown>
        ) : (
          <form onSubmit={save} className="mt-1 space-y-2">
            <Textarea
              aria-label="Edit comment"
              value={editing}
              maxLength={MAX}
              rows={3}
              autoFocus
              onChange={(e) => setEditing(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.stopPropagation(); // close the editor, not the drawer
                  setEditing(null);
                } else submitOnModEnter(e);
              }}
            />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(null)}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={!editing.trim() || edit.isPending}>
                Save
              </Button>
            </div>
          </form>
        )}
      </div>
    </li>
  );
}
