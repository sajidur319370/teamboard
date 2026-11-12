import { createContext, useContext, type ReactNode } from 'react';
import { can, type Permission, type Role, type WorkspaceDto } from '@teamboard/shared';

interface WorkspaceCtx {
  workspace: WorkspaceDto;
  role: Role;
}

const Ctx = createContext<WorkspaceCtx | null>(null);
export const WorkspaceProvider = Ctx.Provider;

/** The current workspace and MY role in it. Only valid under /w/:slug (WorkspaceLayout). */
export function useWorkspace(): WorkspaceCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('useWorkspace must be used inside WorkspaceLayout');
  return v;
}

/** The same can() the API's authorize() uses (FR-RBAC-10). */
export function useCan() {
  const { role } = useWorkspace();
  return (permission: Permission) => can(role, permission);
}

/**
 * Hides UI the user may not use. This is only for comfort: the API enforces every
 * permission on its own, so hiding a button is never the security boundary.
 */
export function Can(props: { perm: Permission; children: ReactNode; fallback?: ReactNode }) {
  const allowed = useCan()(props.perm);
  return <>{allowed ? props.children : (props.fallback ?? null)}</>;
}
