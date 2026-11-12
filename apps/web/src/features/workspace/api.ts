import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type {
  ChangeRoleInput,
  CreateInviteInput,
  CreateInviteResponse,
  CreateWorkspaceInput,
  InviteDto,
  MemberDto,
  TransferOwnershipInput,
  UpdateWorkspaceInput,
  WorkspaceDto,
  WorkspaceResponse,
} from '@teamboard/shared';
import { ApiError, http } from '@/api/client';
import { qk } from '@/api/keys';

// ── Queries ────────────────────────────────────────────────────────────────

export const useWorkspaceQuery = (slug: string) =>
  useQuery({
    queryKey: qk.workspace(slug),
    queryFn: () => http.get<WorkspaceResponse>(`/w/${slug}`),
    enabled: !!slug,
  });

export const useMembers = (slug: string) =>
  useQuery({
    queryKey: qk.members(slug),
    queryFn: () => http.get<{ members: MemberDto[] }>(`/w/${slug}/members`).then((r) => r.members),
  });

export const useInvites = (slug: string, enabled = true) =>
  useQuery({
    queryKey: qk.invites(slug),
    queryFn: () => http.get<{ invites: InviteDto[] }>(`/w/${slug}/invites`).then((r) => r.invites),
    enabled,
  });

export type SlugCheck = { available: boolean; reason?: string };
export const useSlugCheck = (slug: string) =>
  useQuery({
    queryKey: qk.slugCheck(slug),
    queryFn: () => http.get<SlugCheck>(`/workspaces/check-slug?slug=${encodeURIComponent(slug)}`),
    enabled: slug.length >= 3,
    staleTime: 10_000,
  });

// ── Error handling (requirement §22.3) ─────────────────────────────────────

/**
 * Toast the message. A 403 means our idea of our role is stale (someone changed it):
 * refetch the workspace so the UI re-renders with the real role.
 */
export function reportMutationError(qc: QueryClient, slug: string) {
  return (err: unknown) => {
    toast.error(err instanceof Error ? err.message : 'Something went wrong');
    if (err instanceof ApiError && (err.status === 403 || err.status === 404)) {
      void qc.invalidateQueries({ queryKey: qk.workspace(slug) });
    }
  };
}

// ── Workspace ──────────────────────────────────────────────────────────────

export function useCreateWorkspace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: CreateWorkspaceInput) =>
      http.post<{ workspace: WorkspaceDto }>('/workspaces', v),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.me }),
  });
}

export function useUpdateWorkspace(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: UpdateWorkspaceInput) =>
      http.patch<{ workspace: WorkspaceDto }>(`/w/${slug}`, v),
    onSuccess: ({ workspace }) => {
      qc.setQueryData<WorkspaceResponse>(qk.workspace(slug), (old) =>
        old ? { ...old, workspace } : old,
      );
      void qc.invalidateQueries({ queryKey: qk.me }); // the name shows in the switcher
    },
  });
}

export function useDeleteWorkspace(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (confirmName: string) => http.delete<void>(`/w/${slug}`, { confirmName }),
    onSuccess: async () => {
      qc.removeQueries({ queryKey: qk.workspace(slug) }); // drops members, invites… too
      await qc.invalidateQueries({ queryKey: qk.me });
    },
  });
}

export function useTransferOwnership(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: TransferOwnershipInput) => http.post<void>(`/w/${slug}/transfer-ownership`, v),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: qk.workspace(slug) }); // my role changed
      await qc.invalidateQueries({ queryKey: qk.me });
    },
  });
}

// ── Members ────────────────────────────────────────────────────────────────

export function useChangeRole(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, role }: ChangeRoleInput & { userId: string }) =>
      http.patch<{ member: MemberDto }>(`/w/${slug}/members/${userId}`, { role }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.members(slug) }),
    onError: reportMutationError(qc, slug),
  });
}

export function useRemoveMember(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => http.delete<void>(`/w/${slug}/members/${userId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.members(slug) }),
    onError: reportMutationError(qc, slug),
  });
}

export function useLeaveWorkspace(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => http.post<void>(`/w/${slug}/leave`),
    onSuccess: async () => {
      qc.removeQueries({ queryKey: qk.workspace(slug) });
      await qc.invalidateQueries({ queryKey: qk.me });
    },
    onError: reportMutationError(qc, slug),
  });
}

// ── Invites ────────────────────────────────────────────────────────────────

export function useCreateInvite(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: CreateInviteInput) => http.post<CreateInviteResponse>(`/w/${slug}/invites`, v),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.invites(slug) }),
  });
}

export function useRevokeInvite(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (inviteId: string) => http.delete<void>(`/w/${slug}/invites/${inviteId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.invites(slug) }),
    onError: reportMutationError(qc, slug),
  });
}
