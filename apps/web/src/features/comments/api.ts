import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  CommentDto,
  CreateCommentResponse,
  DeleteCommentResponse,
  Page,
} from '@teamboard/shared';
import { http } from '@/api/client';
import { qk } from '@/api/keys';
import { newMutationId } from '@/socket/mutationIds';
import { appendComment, removeComment, replaceComment } from '@/socket/commentsCache';
import { patchCommentCount, patchComments } from '@/socket/queryPatches';

/** FR-CMT-04: oldest first, 50 per page, "Load more" follows the cursor. */
export const useComments = (slug: string, taskId: string) =>
  useInfiniteQuery({
    queryKey: qk.comments(slug, taskId),
    queryFn: ({ pageParam }) =>
      http.get<Page<CommentDto>>(
        `/w/${slug}/tasks/${taskId}/comments${pageParam ? `?cursor=${pageParam}` : ''}`,
      ),
    initialPageParam: '' as string, // '' = first page; then the server's nextCursor
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

/** Write straight into the caches (no refetch): the list and the card's count. */
export function useAddComment(slug: string, key: string, taskId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: string) =>
      http.post<CreateCommentResponse>(
        `/w/${slug}/tasks/${taskId}/comments`,
        { body },
        { clientMutationId: newMutationId() }, // our own socket echo is skipped (FR-RT-08)
      ),
    onSuccess: ({ comment, commentCount }) => {
      patchComments(qc, slug, taskId, (d) => appendComment(d, comment));
      patchCommentCount(qc, slug, key, taskId, commentCount);
    },
  });
}

export function useEditComment(slug: string, taskId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; body: string }) =>
      http.patch<{ comment: CommentDto }>(
        `/w/${slug}/comments/${v.id}`,
        { body: v.body },
        { clientMutationId: newMutationId() },
      ),
    onSuccess: ({ comment }) => patchComments(qc, slug, taskId, (d) => replaceComment(d, comment)),
  });
}

export function useDeleteComment(slug: string, key: string, taskId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      http.delete<DeleteCommentResponse>(`/w/${slug}/comments/${id}`, undefined, {
        clientMutationId: newMutationId(),
      }),
    onSuccess: ({ commentCount }, id) => {
      patchComments(qc, slug, taskId, (d) => removeComment(d, id));
      patchCommentCount(qc, slug, key, taskId, commentCount);
    },
  });
}
