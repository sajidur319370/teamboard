import { useInfiniteQuery } from '@tanstack/react-query';
import type { ActivityDto, Page } from '@teamboard/shared';
import { http } from '@/api/client';
import { qk, type ActivityFilter } from '@/api/keys';

/** FR-ACT-06: newest first, 30 per page; the cursor comes from the previous page. */
export const useActivities = (slug: string, filter: ActivityFilter) =>
  useInfiniteQuery({
    queryKey: qk.activity(slug, filter),
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(filter)) if (v) params.set(k, String(v));
      if (pageParam) params.set('cursor', pageParam);
      const qs = params.toString();
      return http.get<Page<ActivityDto>>(`/w/${slug}/activities${qs ? `?${qs}` : ''}`);
    },
    initialPageParam: '' as string, // '' = first page; then the server's nextCursor
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
