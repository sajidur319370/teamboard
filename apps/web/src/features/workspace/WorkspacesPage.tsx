import { Link, Navigate, useSearchParams } from 'react-router';
import { ChevronRightIcon, PlusIcon } from 'lucide-react';
import { AppHeader } from '@/components/AppHeader';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useMe } from '@/features/auth/useMe';
import { ROLE_LABEL } from '@/lib/format';
import { lastWorkspace } from '@/lib/lastWorkspace';

/**
 * /workspaces. After login you land here, and we forward you:
 *  - no workspaces → onboarding (FR-UI-08, edge case E20)
 *  - a remembered last workspace you still belong to → straight there (FR-WS-03)
 * `?all=1` (the switcher's "All workspaces") always shows the list.
 */
export function WorkspacesPage() {
  const me = useMe().data!; // RequireAuth guarantees it
  const [params] = useSearchParams();
  const showAll = params.has('all');

  if (me.workspaces.length === 0) return <Navigate to="/onboarding" replace />;
  if (!showAll) {
    const last = lastWorkspace();
    const target =
      me.workspaces.find((w) => w.slug === last) ??
      (me.workspaces.length === 1 ? me.workspaces[0] : undefined);
    if (target) return <Navigate to={`/w/${target.slug}`} replace />;
  }

  return (
    <>
      <AppHeader />
      <main className="mx-auto max-w-xl p-4 sm:p-8">
        <h1 className="mb-6 text-2xl font-bold tracking-tight">Your workspaces</h1>
        <ul className="divide-y rounded-lg border">
          {me.workspaces.map((w) => (
            <li key={w.id}>
              <Link
                to={`/w/${w.slug}`}
                className="flex items-center justify-between gap-3 p-4 hover:bg-muted/50"
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium">{w.name}</span>
                  <span className="block truncate text-sm text-muted-foreground">/w/{w.slug}</span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <Badge variant="secondary">{ROLE_LABEL[w.role]}</Badge>
                  <ChevronRightIcon className="size-4 text-muted-foreground" />
                </span>
              </Link>
            </li>
          ))}
        </ul>
        <Button asChild variant="outline" className="mt-6">
          <Link to="/onboarding">
            <PlusIcon /> Create workspace
          </Link>
        </Button>
      </main>
    </>
  );
}
