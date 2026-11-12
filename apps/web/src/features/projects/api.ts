import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreateProjectInput, ProjectDto, ProjectListItemDto } from '@teamboard/shared';
import { http } from '@/api/client';
import { qk } from '@/api/keys';

export const useProjects = (slug: string, includeArchived = false) =>
  useQuery({
    queryKey: [...qk.projects(slug), includeArchived ? 'all' : 'active'],
    queryFn: () =>
      http
        .get<{ projects: ProjectListItemDto[] }>(
          `/w/${slug}/projects${includeArchived ? '?archived=true' : ''}`,
        )
        .then((r) => r.projects),
  });

export function useCreateProject(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: CreateProjectInput) =>
      http.post<{ project: ProjectDto }>(`/w/${slug}/projects`, v),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.projects(slug) }),
  });
}
