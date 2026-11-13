import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { InfiniteData } from '@tanstack/react-query';
import type { NotificationDto, Page } from '@teamboard/shared';
import { http } from '@/api/client';
import { qk } from '@/api/keys';

/** The badge. Kept fresh by notification:new / notification:read (useWorkspaceSocket). */
export const useUnreadCount = (slug: string) =>
  useQuery({
    queryKey: qk.unread(slug),
    queryFn: () =>
      http.get<{ count: number }>(`/w/${slug}/notifications/unread-count`).then((r) => r.count),
  });

/** FR-NTF-06: the newest 20, more on demand. Loaded when the dropdown opens. */
export const useNotifications = (slug: string, enabled: boolean) =>
  useInfiniteQuery({
    queryKey: qk.notifications(slug),
    queryFn: ({ pageParam }) =>
      http.get<Page<NotificationDto>>(
        `/w/${slug}/notifications?limit=20${pageParam ? `&cursor=${pageParam}` : ''}`,
      ),
    initialPageParam: '' as string,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled,
  });

type Pages = InfiniteData<Page<NotificationDto>>;

/** Mark read in the cache right away; the server's answer is just "ok". */
function markLocal(pages: Pages | undefined, ids: Set<string> | 'all', at: string) {
  if (!pages) return pages;
  return {
    ...pages,
    pages: pages.pages.map((p) => ({
      ...p,
      items: p.items.map((n) =>
        !n.readAt && (ids === 'all' || ids.has(n.id)) ? { ...n, readAt: at } : n,
      ),
    })),
  };
}

export function useMarkRead(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => http.post<void>(`/w/${slug}/notifications/${id}/read`),
    onMutate: (id) => {
      qc.setQueryData<Pages>(qk.notifications(slug), (d) =>
        markLocal(d, new Set([id]), new Date().toISOString()),
      );
      qc.setQueryData<number>(qk.unread(slug), (c) => Math.max(0, (c ?? 1) - 1));
    },
    onSettled: () => qc.invalidateQueries({ queryKey: qk.unread(slug) }), // the server's truth
  });
}

export function useMarkAllRead(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => http.post<void>(`/w/${slug}/notifications/read-all`),
    onSuccess: () => {
      qc.setQueryData<Pages>(qk.notifications(slug), (d) =>
        markLocal(d, 'all', new Date().toISOString()),
      );
      qc.setQueryData(qk.unread(slug), 0);
    },
  });
}
