import { useState } from 'react';
import { useNavigate } from 'react-router';
import { BellIcon } from 'lucide-react';
import type { NotificationDto } from '@teamboard/shared';
import { UserAvatar } from '@/components/UserAvatar';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Skeleton } from '@/components/ui/skeleton';
import { relativeTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useMarkAllRead, useMarkRead, useNotifications, useUnreadCount } from './api';
import { badgeText, describeNotification, notificationTarget } from './renderNotification';

/** FR-NTF-06/07/08: the bell, for the CURRENT workspace. */
export function NotificationBell({ slug }: { slug: string }) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const unread = useUnreadCount(slug);
  const list = useNotifications(slug, open); // fetched when the dropdown opens
  const markRead = useMarkRead(slug);
  const markAll = useMarkAllRead(slug);
  const count = unread.data ?? 0;
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];

  const openItem = (n: NotificationDto) => {
    if (!n.readAt) markRead.mutate(n.id);
    const to = notificationTarget(slug, n);
    setOpen(false);
    if (to) void navigate(to);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          aria-label={count ? `Notifications, ${count} unread` : 'Notifications'}
        >
          <BellIcon className="size-5" />
          {count > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-4 rounded-full bg-red-600 px-1 text-[10px] leading-4 font-semibold text-white">
              {badgeText(count)}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(24rem,calc(100vw-1rem))] p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <h2 className="text-sm font-semibold">Notifications</h2>
          <Button
            variant="ghost"
            size="xs"
            disabled={count === 0 || markAll.isPending}
            onClick={() => markAll.mutate()}
          >
            Mark all as read
          </Button>
        </div>

        <div className="max-h-[min(28rem,70vh)] overflow-y-auto">
          {list.isPending && (
            <div className="space-y-2 p-3" aria-busy="true">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          )}
          {list.error && <p className="p-3 text-sm text-destructive">{list.error.message}</p>}
          {list.data && items.length === 0 && (
            <p className="p-6 text-center text-sm text-muted-foreground">You're all caught up.</p>
          )}
          <ul>
            {items.map((n) => (
              <li key={n.id}>
                <button
                  type="button"
                  onClick={() => openItem(n)}
                  className={cn(
                    'flex w-full items-start gap-3 px-3 py-2.5 text-left text-sm hover:bg-muted focus-visible:bg-muted focus-visible:outline-none',
                    !n.readAt && 'bg-primary/5',
                  )}
                >
                  <UserAvatar
                    name={n.actor.name}
                    color={n.actor.avatarColor}
                    className="mt-0.5 size-7 text-xs"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block leading-snug">
                      <b className="font-medium">{n.actor.name}</b> {describeNotification(n)}
                    </span>
                    <time dateTime={n.createdAt} className="text-xs text-muted-foreground">
                      {relativeTime(n.createdAt)}
                    </time>
                  </span>
                  {!n.readAt && (
                    <span className="mt-2 size-2 shrink-0 rounded-full bg-primary">
                      <span className="sr-only">Unread</span>
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
          {list.hasNextPage && (
            <div className="border-t p-2 text-center">
              <Button
                variant="ghost"
                size="sm"
                disabled={list.isFetchingNextPage}
                onClick={() => void list.fetchNextPage()}
              >
                {list.isFetchingNextPage ? 'Loading…' : 'Load more'}
              </Button>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
