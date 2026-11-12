import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type {
  ColumnDto,
  CreateColumnInput,
  CreateProjectInput,
  LabelDto,
  LabelInput,
  MyTasksResponse,
  ProjectDto,
  ProjectListItemDto,
  UpdateColumnInput,
  UpdateLabelInput,
  UpdateProjectInput,
} from '@teamboard/shared';
import { ApiError, http } from '@/api/client';
import { qk } from '@/api/keys';

// ── Queries ────────────────────────────────────────────────────────────────

export const useProjects = (slug: string, includeArchived = false) =>
  useQuery({
    queryKey: [...qk.projects(slug), includeArchived ? 'all' : 'active'],
    queryFn: () =>
      http
        .get<{
          projects: ProjectListItemDto[];
        }>(`/w/${slug}/projects${includeArchived ? '?archived=true' : ''}`)
        .then((r) => r.projects),
  });

export const useProject = (slug: string, key: string) =>
  useQuery({
    queryKey: qk.project(slug, key),
    queryFn: () =>
      http.get<{ project: ProjectDto }>(`/w/${slug}/projects/${key}`).then((r) => r.project),
  });

export const useMyTasks = (slug: string) =>
  useQuery({
    queryKey: qk.myTasks(slug),
    queryFn: () => http.get<MyTasksResponse>(`/w/${slug}/my-tasks`),
  });

// ── Shared mutation plumbing ──────────────────────────────────────────────

/** Everything that shows a project: its board(s), its settings, the projects list. */
function invalidateProject(qc: QueryClient, slug: string, key: string) {
  void qc.invalidateQueries({ queryKey: qk.boardAll(slug, key) });
  void qc.invalidateQueries({ queryKey: qk.project(slug, key) });
  void qc.invalidateQueries({ queryKey: qk.projects(slug) });
}

/**
 * Toast the server's message. A 409 RETRY means "the board changed while you were
 * editing" (compare-and-set): refetch so the next attempt starts from fresh data.
 */
function onAdminError(qc: QueryClient, slug: string, key: string) {
  return (err: unknown) => {
    toast.error(err instanceof Error ? err.message : 'Something went wrong');
    if (err instanceof ApiError && (err.code === 'RETRY' || err.status === 404)) {
      invalidateProject(qc, slug, key);
    }
  };
}

function useProjectMutation<TVars, TResult>(
  slug: string,
  key: string,
  fn: (v: TVars) => Promise<TResult>,
  opts: { toastErrors?: boolean } = { toastErrors: true },
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => invalidateProject(qc, slug, key),
    ...(opts.toastErrors && { onError: onAdminError(qc, slug, key) }),
  });
}

// ── Projects ───────────────────────────────────────────────────────────────

export function useCreateProject(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: CreateProjectInput) =>
      http.post<{ project: ProjectDto }>(`/w/${slug}/projects`, v),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.projects(slug) }),
  });
}

export const useUpdateProject = (slug: string, key: string) =>
  useProjectMutation(
    slug,
    key,
    (v: UpdateProjectInput) => http.patch<{ project: ProjectDto }>(`/w/${slug}/projects/${key}`, v),
    { toastErrors: false }, // the settings form shows errors under its fields
  );

export const useSetArchived = (slug: string, key: string) =>
  useProjectMutation(slug, key, (archived: boolean) =>
    http.post<{ project: ProjectDto }>(
      `/w/${slug}/projects/${key}/${archived ? 'archive' : 'unarchive'}`,
    ),
  );

export function useDeleteProject(slug: string, key: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (confirmKey: string) =>
      http.delete<void>(`/w/${slug}/projects/${key}`, { confirmKey }),
    onSuccess: () => {
      qc.removeQueries({ queryKey: qk.boardAll(slug, key) });
      qc.removeQueries({ queryKey: qk.project(slug, key) });
      void qc.invalidateQueries({ queryKey: qk.projects(slug) });
      void qc.invalidateQueries({ queryKey: qk.myTasks(slug) });
    },
  });
}

// ── Columns (FR-BRD-03..06) ────────────────────────────────────────────────

type Cols = { columns: ColumnDto[] };
const colsUrl = (slug: string, key: string) => `/w/${slug}/projects/${key}/columns`;

export const useAddColumn = (slug: string, key: string) =>
  useProjectMutation(slug, key, (v: CreateColumnInput) => http.post<Cols>(colsUrl(slug, key), v));

export const useUpdateColumn = (slug: string, key: string) =>
  useProjectMutation(slug, key, ({ id, ...v }: UpdateColumnInput & { id: string }) =>
    http.patch<Cols>(`${colsUrl(slug, key)}/${id}`, v),
  );

export const useReorderColumns = (slug: string, key: string) =>
  useProjectMutation(slug, key, (columnIds: string[]) =>
    http.put<Cols>(`${colsUrl(slug, key)}/order`, { columnIds }),
  );

export const useDeleteColumn = (slug: string, key: string) =>
  useProjectMutation(slug, key, (v: { id: string; targetColumnId?: string }) =>
    http.delete<Cols>(
      `${colsUrl(slug, key)}/${v.id}`,
      v.targetColumnId ? { targetColumnId: v.targetColumnId } : {},
    ),
  );

// ── Labels (FR-PRJ-08) ─────────────────────────────────────────────────────

type Labels = { labels: LabelDto[] };
const labelsUrl = (slug: string, key: string) => `/w/${slug}/projects/${key}/labels`;

export const useAddLabel = (slug: string, key: string) =>
  useProjectMutation(slug, key, (v: LabelInput) => http.post<Labels>(labelsUrl(slug, key), v));

export const useUpdateLabel = (slug: string, key: string) =>
  useProjectMutation(slug, key, ({ id, ...v }: UpdateLabelInput & { id: string }) =>
    http.patch<Labels>(`${labelsUrl(slug, key)}/${id}`, v),
  );

export const useDeleteLabel = (slug: string, key: string) =>
  useProjectMutation(slug, key, (id: string) =>
    http.delete<Labels>(`${labelsUrl(slug, key)}/${id}`),
  );
