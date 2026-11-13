import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import type { Role, WorkspaceDto, WorkspaceResponse } from '@teamboard/shared';
import { qk } from '@/api/keys';
import { forgetWorkspace } from '@/lib/lastWorkspace';
import { ROLE_LABEL } from '@/lib/format';
import { getSocket } from './client';
import { markWorkspaceJoined } from './workspaceJoin';

/**
 * Connects the socket (if needed), joins workspace:<id>, and handles the workspace-wide
 * events. Rendered by WorkspaceLayout once the workspace has loaded.
 */
export function useWorkspaceSocket(workspace: WorkspaceDto) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const connectedOnce = useRef(false);
  const { id, slug, name } = workspace;

  useEffect(() => {
    const s = getSocket();

    const join = () => {
      s.emit('workspace:join', { workspaceId: id }, (r) => {
        if (r.ok)
          markWorkspaceJoined(id); // board rooms may join now
        else console.warn('workspace:join failed', r.code);
      });
      // Reconnect = resync (FR-RT-10): events missed while offline aren't replayed, so refetch
      // everything for this workspace (board, members, projects, the unread count on Day 17).
      if (connectedOnce.current) void qc.invalidateQueries({ queryKey: ['w', slug] });
      connectedOnce.current = true;
    };
    const onDisconnect = () => markWorkspaceJoined(null);

    // E5 / FR-RT-11: removed (or the workspace was deleted) while looking at it.
    const onRevoked = (p: { workspaceId: string }) => {
      if (p.workspaceId !== id) return;
      toast.error(`You no longer have access to ${name}.`);
      forgetWorkspace(slug);
      navigate('/workspaces?all=1', { replace: true }); // leave first, so nothing refetches here…
      setTimeout(() => qc.removeQueries({ queryKey: ['w', slug] }), 0); // …then drop the data
      void qc.invalidateQueries({ queryKey: qk.me });
    };

    // E4 / FR-RT-12: the UI adapts to the new role immediately, no reload.
    const onRoleChanged = (p: { workspaceId: string; role: Role }) => {
      if (p.workspaceId !== id) return;
      qc.setQueryData<WorkspaceResponse>(qk.workspace(slug), (d) =>
        d ? { ...d, role: p.role } : d,
      );
      void qc.invalidateQueries({ queryKey: qk.me });
      void qc.invalidateQueries({ queryKey: qk.members(slug) });
      toast.info(`Your role in ${name} is now ${ROLE_LABEL[p.role]}.`);
    };

    const refreshProjects = () => void qc.invalidateQueries({ queryKey: qk.projects(slug) });
    const refreshMembers = () => void qc.invalidateQueries({ queryKey: qk.members(slug) });

    s.on('connect', join);
    s.on('disconnect', onDisconnect);
    s.on('membership:revoked', onRevoked);
    s.on('membership:roleChanged', onRoleChanged);
    s.on('project:created', refreshProjects);
    s.on('project:updated', refreshProjects);
    s.on('project:archived', refreshProjects);
    s.on('project:deleted', refreshProjects);
    s.on('member:joined', refreshMembers);
    s.on('member:roleChanged', refreshMembers);
    s.on('member:removed', refreshMembers);

    if (s.connected) join();
    else s.connect(); // → 'connect' → join()

    return () => {
      markWorkspaceJoined(null); // switching workspaces: boards wait for the new join
      s.off('connect', join);
      s.off('disconnect', onDisconnect);
      s.off('membership:revoked', onRevoked);
      s.off('membership:roleChanged', onRoleChanged);
      s.off('project:created', refreshProjects);
      s.off('project:updated', refreshProjects);
      s.off('project:archived', refreshProjects);
      s.off('project:deleted', refreshProjects);
      s.off('member:joined', refreshMembers);
      s.off('member:roleChanged', refreshMembers);
      s.off('member:removed', refreshMembers);
    };
  }, [id, slug, name, qc, navigate]);
}

/** Renders nothing; lets WorkspaceLayout use the hook only once the workspace is loaded. */
export function WorkspaceRealtime({ workspace }: { workspace: WorkspaceDto }) {
  useWorkspaceSocket(workspace);
  return null;
}
