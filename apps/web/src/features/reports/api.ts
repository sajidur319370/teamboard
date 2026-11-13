import { useQuery } from '@tanstack/react-query';
import type {
  BurndownResponse,
  MembersReportResponse,
  SummaryReportResponse,
} from '@teamboard/shared';
import { http } from '@/api/client';
import { qk } from '@/api/keys';

const get = <T>(slug: string, sprintId: string, part: string) =>
  http.get<T>(`/w/${slug}/sprints/${sprintId}/reports/${part}`);

/** One request: each point carries BOTH units, so the unit toggle needs no refetch. */
export const useBurndown = (slug: string, sprintId: string) =>
  useQuery({
    queryKey: [...qk.report(slug, sprintId), 'burndown'],
    queryFn: () => get<BurndownResponse>(slug, sprintId, 'burndown'),
  });

export const useMemberReport = (slug: string, sprintId: string) =>
  useQuery({
    queryKey: [...qk.report(slug, sprintId), 'members'],
    queryFn: () => get<MembersReportResponse>(slug, sprintId, 'members'),
  });

export const useSummaryReport = (slug: string, sprintId: string) =>
  useQuery({
    queryKey: [...qk.report(slug, sprintId), 'summary'],
    queryFn: () => get<SummaryReportResponse>(slug, sprintId, 'summary'),
  });
