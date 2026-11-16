import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { CrownIcon, EyeIcon, ShieldIcon, UserIcon, type LucideIcon } from 'lucide-react';
import { DEMO_WORKSPACE_SLUG, type DemoRole } from '@teamboard/shared';
import { cn } from '@/lib/utils';
import { useDemoInfo, useDemoLogin } from './useAuthActions';

const ROLES: Record<DemoRole, { label: string; hint: string; icon: LucideIcon }> = {
  owner: { label: 'Owner', hint: 'Everything, incl. workspace settings', icon: CrownIcon },
  admin: { label: 'Admin', hint: 'Sprints, columns, members', icon: ShieldIcon },
  member: {
    label: 'Member',
    hint: 'Tasks and comments; use in a second browser',
    icon: UserIcon,
  },
  viewer: { label: 'Viewer', hint: 'Read-only, can open reports', icon: EyeIcon },
};

/** Where a demo visitor lands: the running sprint, the most telling screen. */
const DEMO_START = `/w/${DEMO_WORKSPACE_SLUG}/p/MOB/board`;

/**
 * Public demo (DEMO_MODE on the server): one click per role, no password to type.
 * Renders nothing when the server isn't in demo mode.
 */
export function DemoLogin({ returnTo }: { returnTo: string | null }) {
  const info = useDemoInfo();
  const target = returnTo ?? DEMO_START;
  const login = useDemoLogin(target);
  const [, setParams] = useSearchParams();
  // A login that takes more than a few seconds is waiting for the daily demo rebuild.
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!login.isPending) return;
    const t = setTimeout(() => setSlow(true), 3000);
    return () => {
      clearTimeout(t);
      setSlow(false);
    };
  }, [login.isPending]);
  if (!info.data?.enabled) return null;

  const pick = (role: DemoRole) => {
    // GuestOnly redirects a signed-in user to ?returnTo the moment /me is cached: put the
    // demo start page there too, or it would win the race and land on /workspaces.
    setParams({ returnTo: target }, { replace: true });
    login.mutate(role, { onError: (e) => toast.error(e.message) });
  };

  return (
    <section aria-labelledby="demo-heading" className="mb-6 space-y-3">
      <div>
        <h2 id="demo-heading" className="text-sm font-semibold">
          Try the demo: log in with one click
        </h2>
        <p className="text-xs text-muted-foreground">
          A sample team with real history. Open a second browser as the Member to watch changes
          appear live.
          {info.data.resetHours && ` Demo data resets every ${info.data.resetHours} hours.`}
        </p>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {info.data.accounts.map(({ role }) => {
          const r = ROLES[role];
          const busy = login.isPending && login.variables === role;
          return (
            <button
              key={role}
              type="button"
              onClick={() => pick(role)}
              disabled={login.isPending}
              aria-label={`Log in as ${r.label}: ${r.hint}`}
              className={cn(
                'flex items-start gap-2.5 rounded-lg border p-3 text-left transition-colors',
                'hover:border-primary hover:bg-primary/5 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                'disabled:cursor-wait disabled:opacity-60',
              )}
            >
              <r.icon className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
              <span className="min-w-0">
                <span className="block text-sm font-medium">
                  {busy ? (slow ? 'Preparing a fresh demo…' : 'Logging in…') : r.label}
                </span>
                <span className="block text-xs text-muted-foreground">{r.hint}</span>
              </span>
            </button>
          );
        })}
      </div>
      {slow && (
        <p role="status" className="text-xs text-muted-foreground">
          The first visit of the day rebuilds the demo data. This takes about a minute.
        </p>
      )}
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <span className="h-px flex-1 bg-border" />
        or log in with your own account
        <span className="h-px flex-1 bg-border" />
      </div>
    </section>
  );
}
