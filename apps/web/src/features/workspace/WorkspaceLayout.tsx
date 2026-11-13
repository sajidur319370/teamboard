import { useEffect } from 'react';
import { NavLink, Outlet, useParams } from 'react-router';
import {
  ActivityIcon,
  FolderKanbanIcon,
  ListChecksIcon,
  SettingsIcon,
  UsersIcon,
  type LucideIcon,
} from 'lucide-react';
import { ApiError } from '@/api/client';
import { AppHeader } from '@/components/AppHeader';
import { FullPageSpinner } from '@/components/FullPageSpinner';
import { NotFoundPage } from '@/components/NotFoundPage';
import { Button } from '@/components/ui/button';
import { forgetWorkspace, rememberWorkspace } from '@/lib/lastWorkspace';
import { cn } from '@/lib/utils';
import { useWorkspaceQuery } from './api';
import { WorkspaceProvider } from './WorkspaceContext';
import { ConnectionPill } from '@/socket/connection';
import { WorkspaceRealtime } from '@/socket/useWorkspaceSocket';

const NAV: { to: string; label: string; icon: LucideIcon }[] = [
  { to: 'projects', label: 'Projects', icon: FolderKanbanIcon },
  { to: 'my-tasks', label: 'My tasks', icon: ListChecksIcon },
  { to: 'activity', label: 'Activity', icon: ActivityIcon },
  { to: 'members', label: 'Members', icon: UsersIcon },
  { to: 'settings', label: 'Settings', icon: SettingsIcon },
];

/**
 * /w/:slug: loads GET /w/:slug once and gives { workspace, role } to every child page.
 * The role comes from the API, so a role change shows up as soon as this query refetches.
 */
export function WorkspaceLayout() {
  const { slug = '' } = useParams();
  const q = useWorkspaceQuery(slug);
  const notFound = q.error instanceof ApiError && q.error.status === 404;

  useEffect(() => {
    if (q.data) rememberWorkspace(slug);
    if (notFound) forgetWorkspace(slug);
  }, [q.data, notFound, slug]);

  if (q.isPending) return <FullPageSpinner />;
  if (notFound)
    return <NotFoundPage message="This workspace doesn't exist, or you're not a member." />; // §22.3
  if (q.error) {
    return (
      <div className="grid h-screen place-items-center p-4 text-center">
        <div className="space-y-3">
          <p className="text-destructive">{q.error.message}</p>
          <Button variant="outline" onClick={() => q.refetch()}>
            Try again
          </Button>
        </div>
      </div>
    );
  }

  const link = ({ isActive }: { isActive: boolean }) =>
    cn(
      'flex items-center gap-2 rounded-md px-3 py-2 text-sm whitespace-nowrap',
      isActive ? 'bg-muted font-medium text-foreground' : 'text-muted-foreground hover:bg-muted/60',
    );

  const links = NAV.map(({ to, label, icon: Icon }) => (
    <NavLink key={to} to={to} className={link}>
      <Icon className="size-4" /> {label}
    </NavLink>
  ));

  return (
    <WorkspaceProvider value={q.data}>
      <div className="flex h-screen flex-col">
        <AppHeader current={q.data.workspace} />
        {/* Live updates: join workspace:<id>, handle role changes and removal (Day 15) */}
        <WorkspaceRealtime workspace={q.data.workspace} />
        <ConnectionPill />
        {/* Phones: the nav becomes a scrollable row under the header */}
        <nav
          className="flex gap-1 overflow-x-auto border-b px-2 py-1.5 md:hidden"
          aria-label="Workspace"
        >
          {links}
        </nav>
        <div className="flex min-h-0 flex-1">
          <nav
            className="hidden w-56 shrink-0 space-y-1 border-r p-3 md:block"
            aria-label="Workspace"
          >
            {links}
          </nav>
          <main className="min-w-0 flex-1 overflow-auto">
            <Outlet />
          </main>
        </div>
      </div>
    </WorkspaceProvider>
  );
}
