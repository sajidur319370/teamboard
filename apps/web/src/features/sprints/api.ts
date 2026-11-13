import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type {
  BacklogResponse,
  CreateSprintInput,
  SprintDto,
  SprintState,
  UpdateSprintInput,
} from '@teamboard/shared';
import { http } from '@/api/client';
import { qk } from '@/api/keys';
import { newMutationId } from '@/socket/mutationIds';

export const useSprints = (slug: string, key: string) =>
  useQuery({
    queryKey: qk.sprints(slug, key),
    queryFn: () =>
      http
        .get<{ sprints: SprintDto[] }>(`/w/${slug}/projects/${key}/sprints`)
        .then((r) => r.sprints),
  });

export const useBacklog = (slug: string, key: string) =>
  useQuery({
    queryKey: qk.backlog(slug, key),
    queryFn: () => http.get<BacklogResponse>(`/w/${slug}/projects/${key}/backlog`),
  });

/** Sprint changes touch the backlog, the sprint list, every board view and the reports. */
export function refreshSprintViews(qc: QueryClient, slug: string, key: string) {
  void qc.invalidateQueries({ queryKey: qk.backlog(slug, key) });
  void qc.invalidateQueries({ queryKey: qk.sprints(slug, key) });
  void qc.invalidateQueries({ queryKey: qk.boardAll(slug, key) });
  void qc.invalidateQueries({ queryKey: qk.projects(slug) }); // the "active sprint" column
  void qc.invalidateQueries({ queryKey: ['w', slug, 'report'] });
}

function useSprintMutation<V, R>(slug: string, key: string, fn: (v: V) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => refreshSprintViews(qc, slug, key) });
}

const opts = () => ({ clientMutationId: newMutationId() });

export const useCreateSprint = (slug: string, key: string) =>
  useSprintMutation(slug, key, (v: CreateSprintInput) =>
    http.post<{ sprint: SprintDto }>(`/w/${slug}/projects/${key}/sprints`, v, opts()),
  );

export const useUpdateSprint = (slug: string, key: string) =>
  useSprintMutation(slug, key, ({ id, ...v }: UpdateSprintInput & { id: string }) =>
    http.patch<{ sprint: SprintDto }>(`/w/${slug}/sprints/${id}`, v, opts()),
  );

export const useDeleteSprint = (slug: string, key: string) =>
  useSprintMutation(slug, key, (id: string) =>
    http.delete<void>(`/w/${slug}/sprints/${id}`, undefined, opts()),
  );

export const useStartSprint = (slug: string, key: string) =>
  useSprintMutation(slug, key, (id: string) =>
    http.post<{ sprint: SprintDto }>(`/w/${slug}/sprints/${id}/start`, undefined, opts()),
  );

export const useCompleteSprint = (slug: string, key: string) =>
  useSprintMutation(slug, key, (v: { id: string; carryOverTo: string }) =>
    http.post<{ sprint: SprintDto; carriedOver: number }>(
      `/w/${slug}/sprints/${v.id}/complete`,
      { carryOverTo: v.carryOverTo },
      opts(),
    ),
  );

export const useSprintTasks = (slug: string, key: string) =>
  useSprintMutation(
    slug,
    key,
    (v: { sprintId: string; action: 'add' | 'remove'; taskIds: string[] }) =>
      http.post<{ taskIds: string[] }>(
        `/w/${slug}/sprints/${v.sprintId}/tasks`,
        { action: v.action, taskIds: v.taskIds },
        opts(),
      ),
  );

export const STATE_LABEL: Record<SprintState, string> = {
  planned: 'Planned',
  active: 'Active',
  completed: 'Completed',
};
