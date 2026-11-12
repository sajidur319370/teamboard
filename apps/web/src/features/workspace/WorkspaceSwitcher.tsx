import { Link } from 'react-router';
import { CheckIcon, ChevronsUpDownIcon, LayoutGridIcon, PlusIcon } from 'lucide-react';
import type { WorkspaceDto } from '@teamboard/shared';
import { useMe } from '@/features/auth/useMe';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ROLE_LABEL } from '@/lib/format';

/** FR-WS-03: switch between my workspaces. `current` is undefined outside /w/:slug. */
export function WorkspaceSwitcher({ current }: { current?: WorkspaceDto | undefined }) {
  const { data } = useMe();
  const workspaces = data?.workspaces ?? [];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex max-w-64 items-center gap-2 rounded-md px-2 py-1.5 text-sm font-semibold hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
        <span className="grid size-6 shrink-0 place-items-center rounded bg-primary text-xs text-primary-foreground">
          {(current?.name ?? 'T').slice(0, 1).toUpperCase()}
        </span>
        <span className="truncate">{current?.name ?? 'TeamBoard'}</span>
        <ChevronsUpDownIcon className="size-4 shrink-0 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel className="text-xs text-muted-foreground">Workspaces</DropdownMenuLabel>
        {workspaces.map((w) => (
          <DropdownMenuItem key={w.id} asChild>
            <Link to={`/w/${w.slug}`} className="flex items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-2">
                <CheckIcon className={w.id === current?.id ? 'opacity-100' : 'opacity-0'} />
                <span className="truncate">{w.name}</span>
              </span>
              <Badge variant="secondary">{ROLE_LABEL[w.role]}</Badge>
            </Link>
          </DropdownMenuItem>
        ))}
        {workspaces.length === 0 && (
          <p className="px-2 py-1.5 text-sm text-muted-foreground">No workspaces yet</p>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/workspaces?all=1">
            <LayoutGridIcon /> All workspaces
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/onboarding">
            <PlusIcon /> Create workspace
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
