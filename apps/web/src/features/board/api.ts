import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { BoardResponse, CreateTaskInput, TaskDto, UpdateTaskInput } from '@teamboard/shared';
import { ApiError, http } from '@/api/client';
import { qk } from '@/api/keys';

export const useBoard = (slug: string, key: string, sprint: string) =>
  useQuery({
    queryKey: qk.board(slug, key, sprint),
    queryFn: () =>
      http.get<BoardResponse>(
        `/w/${slug}/projects/${key}/board?sprint=${encodeURIComponent(sprint)}`,
      ),
  });

export const useTask = (slug: string, key: string, number: number) =>
  useQuery({
    queryKey: qk.task(slug, key, number),
    queryFn: () =>
      http.get<{ task: TaskDto }>(`/w/${slug}/projects/${key}/tasks/${number}`).then((r) => r.task),
    enabled: Number.isInteger(number) && number > 0,
  });

export function useCreateTask(slug: string, key: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: CreateTaskInput) =>
      http.post<{ task: TaskDto }>(`/w/${slug}/projects/${key}/tasks`, v),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.boardAll(slug, key) }),
  });
}

export function useUpdateTask(slug: string, key: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...patch }: UpdateTaskInput & { id: string }) =>
      http.patch<{ task: TaskDto }>(`/w/${slug}/tasks/${id}`, patch),
    onSuccess: ({ task }) => {
      qc.setQueryData(qk.task(slug, key, task.number), task); // the drawer updates instantly
      void qc.invalidateQueries({ queryKey: qk.boardAll(slug, key) });
    },
    onError: (err) => {
      // FR-TSK-04: the 409 carries the CURRENT task; show it instead of our stale copy.
      if (err instanceof ApiError && err.code === 'VERSION_CONFLICT' && err.details) {
        const current = err.details as TaskDto;
        qc.setQueryData(qk.task(slug, key, current.number), current);
      }
    },
  });
}

export function useDeleteTask(slug: string, key: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (task: Pick<TaskDto, 'id' | 'number'>) =>
      http.delete<void>(`/w/${slug}/tasks/${task.id}`),
    onSuccess: (_void, task) => {
      qc.removeQueries({ queryKey: qk.task(slug, key, task.number) });
      void qc.invalidateQueries({ queryKey: qk.boardAll(slug, key) });
    },
  });
}
