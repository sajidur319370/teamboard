import type { WorkspaceDto } from '@teamboard/shared';
import { WorkspaceSwitcher } from '@/features/workspace/WorkspaceSwitcher';
import { NotificationBell } from '@/features/notifications/NotificationBell';
import { UserMenu } from './UserMenu';

/** The top bar on every logged-in page. Inside a workspace, pass it as `current`. */
export function AppHeader({ current }: { current?: WorkspaceDto }) {
  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-2 border-b px-3 sm:px-4">
      <WorkspaceSwitcher current={current} />
      <div className="flex items-center gap-3">
        {current && <NotificationBell key={current.slug} slug={current.slug} />}
        <UserMenu />
      </div>
    </header>
  );
}
