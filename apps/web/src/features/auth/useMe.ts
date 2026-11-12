import { useQuery } from '@tanstack/react-query';
import type { MeResponse } from '@teamboard/shared';
import { getAccessToken, http, refreshAccessToken } from '@/api/client';
import { qk } from '@/api/keys';

/**
 * null = logged out. After a page reload there's no access token in memory,
 * so first try the refresh cookie (it survives reloads) to get a new one.
 */
export async function loadMe(): Promise<MeResponse | null> {
  if (!getAccessToken() && !(await refreshAccessToken())) return null;
  return http.get<MeResponse>('/me');
}

export function useMe() {
  return useQuery({ queryKey: qk.me, queryFn: loadMe, staleTime: 5 * 60_000 });
}
