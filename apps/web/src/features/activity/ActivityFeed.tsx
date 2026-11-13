import { useMemo } from 'react';
import { Link } from 'react-router';
import type { ActivityDto, TaskRef, UserRef } from '@teamboard/shared';
import { UserAvatar } from '@/components/UserAvatar';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import type { ActivityFilter } from '@/api/keys';
import { useMembers } from '@/features/workspace/api';
import { relativeTime } from '@/lib/format';
import { useActivities } from './api';
import { describeActivity, mergeMoves, type RenderCtx } from './renderActivity';

/**
 * One feed component, three places: the drawer's History tab (taskId), the project feed
 * (projectId) and the workspace feed (group chips). "Load more" follows the cursor.
 */
export function ActivityFeed(props: {
  slug: string;
  filter: ActivityFilter;
  /** Link task mentions to their drawer (off inside the drawer itself). */
  linkTasks?: boolean;
  emptyText?: string;
}) {
  const { slug, filter, linkTasks = true } = props;
  const feed = useActivities(slug, filter);
  const members = useMembers(slug); // current names, for rows written before name snapshots

  const ctx = useMemo<RenderCtx>(() => {
    const names = new Map((members.data ?? []).map((m) => [m.userId, m.name]));
    return {
      nameOf: (u: UserRef | string) =>
        typeof u === 'string'
          ? (names.get(u) ?? 'someone')
          : (u.name ?? names.get(u.id) ?? 'someone'),
      task: (t: TaskRef, gone?: boolean) => {
        const label = `${t.key}-${t.number}`;
        return linkTasks && !gone ? (
          <Link
            to={`/w/${slug}/p/${t.key}/tasks/${t.number}`}
            title={t.title}
            className="font-medium underline-offset-2 hover:underline"
          >
            {label}
          </Link>
        ) : (
          <b title={t.title}>{label}</b>
        );
      },
    };
  }, [members.data, slug, linkTasks]);

  const items = useMemo(
    () => mergeMoves(feed.data?.pages.flatMap((p) => p.items) ?? []),
    [feed.data],
  );

  if (feed.isPending) {
    return (
      <div className="space-y-3" aria-busy="true" aria-label="Loading activity">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-6 w-full" />
        ))}
      </div>
    );
  }
  if (feed.error) return <p className="text-sm text-destructive">{feed.error.message}</p>;
  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">{props.emptyText ?? 'No activity yet.'}</p>;
  }

  return (
    <div className="space-y-4">
      <ol className="space-y-3">
        {items.map((a) => (
          <ActivityRow key={a.id} a={a} ctx={ctx} />
        ))}
      </ol>
      {feed.hasNextPage && (
        <Button
          variant="outline"
          size="sm"
          disabled={feed.isFetchingNextPage}
          onClick={() => void feed.fetchNextPage()}
        >
          {feed.isFetchingNextPage ? 'Loading…' : 'Load more'}
        </Button>
      )}
    </div>
  );
}

function ActivityRow({ a, ctx }: { a: ActivityDto; ctx: RenderCtx }) {
  return (
    <li className="flex items-start gap-3 text-sm">
      <UserAvatar name={a.actor.name} color={a.actor.avatarColor} className="size-6 text-xs" />
      <p className="min-w-0 flex-1 leading-6">
        <b className="font-medium">{a.actor.name}</b> {describeActivity(a, ctx)}
        <time
          dateTime={a.createdAt}
          title={new Date(a.createdAt).toLocaleString()}
          className="ml-2 text-xs whitespace-nowrap text-muted-foreground"
        >
          {relativeTime(a.createdAt)}
        </time>
      </p>
    </li>
  );
}
