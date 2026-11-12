import type { ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router';
import type { AcceptInviteResponse, InvitePreviewDto } from '@teamboard/shared';
import { ApiError, http } from '@/api/client';
import { qk } from '@/api/keys';
import { FullPageSpinner } from '@/components/FullPageSpinner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useLogout } from '@/features/auth/useAuthActions';
import { useMe } from '@/features/auth/useMe';
import { INVITE_STATUS_TEXT, ROLE_HINT, ROLE_LABEL } from '@/lib/format';

/**
 * /invite/:token: PUBLIC (outside RequireAuth), works logged in or out (journey J2).
 * Logged out: sign up / log in with returnTo pointing back here (FR-INV-08).
 */
export function AcceptInvitePage() {
  const { token = '' } = useParams();
  const me = useMe(); // also restores a session from the refresh cookie
  const qc = useQueryClient();
  const navigate = useNavigate();
  const returnTo = encodeURIComponent(`/invite/${token}`);
  const switchAccount = useLogout({ redirectTo: `/login?returnTo=${returnTo}` });

  const preview = useQuery({
    queryKey: qk.invitePreview(token),
    queryFn: () =>
      http.get<{ invite: InvitePreviewDto }>(`/invites/${token}`).then((r) => r.invite),
    retry: false,
  });
  const accept = useMutation({
    mutationFn: () => http.post<AcceptInviteResponse>(`/invites/${token}/accept`),
    onSuccess: async ({ slug }) => {
      await qc.invalidateQueries({ queryKey: qk.me }); // the switcher must show the new workspace
      navigate(`/w/${slug}`, { replace: true });
    },
  });

  if (preview.isPending || me.isPending) return <FullPageSpinner />;
  if (preview.error) {
    return (
      <Shell title="This invite link isn't valid">
        <p className="text-sm text-muted-foreground">
          Check that you copied the whole link, or ask for a new one.
        </p>
      </Shell>
    );
  }

  const p = preview.data;
  if (p.status !== 'active') {
    return (
      <Shell title="This invite can't be used">
        <p className="text-sm text-muted-foreground">
          The invite to <b>{p.workspace.name}</b> has {INVITE_STATUS_TEXT[p.status]}. Ask{' '}
          {p.inviterName} for a new one.
        </p>
      </Shell>
    );
  }

  const err = accept.error instanceof ApiError ? accept.error : null;

  return (
    <Shell
      title={`${p.inviterName} invited you to ${p.workspace.name}`}
      description={`You'll join as ${ROLE_LABEL[p.role]}: ${ROLE_HINT[p.role].toLowerCase()}.`}
    >
      {p.emailLocked && (
        <p className="text-sm text-muted-foreground">
          This invite is for one specific email address.
        </p>
      )}

      {me.data ? (
        <div className="space-y-2">
          <Button className="w-full" onClick={() => accept.mutate()} disabled={accept.isPending}>
            {accept.isPending ? 'Joining…' : `Join ${p.workspace.name}`}
          </Button>
          <p className="text-center text-xs text-muted-foreground">
            Signed in as {me.data.user.email}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <Button asChild>
            <Link to={`/register?returnTo=${returnTo}`}>Create account</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link to={`/login?returnTo=${returnTo}`}>Log in</Link>
          </Button>
        </div>
      )}

      {err?.code === 'INVITE_EMAIL_MISMATCH' ? (
        // Edge case E15: logged in as the wrong account
        <div
          className="space-y-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive"
          role="alert"
        >
          <p>This invite is for a different email address than {me.data?.user.email}.</p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => switchAccount.mutate()}
            disabled={switchAccount.isPending}
          >
            Log in as a different user
          </Button>
        </div>
      ) : (
        err && (
          <p role="alert" className="text-sm text-destructive">
            {err.message}
          </p>
        )
      )}
    </Shell>
  );
}

function Shell(props: { title: string; description?: string; children: ReactNode }) {
  return (
    <main className="grid min-h-screen place-items-center bg-muted/40 p-4">
      <div className="w-full max-w-sm space-y-6">
        <p className="text-center text-xl font-bold tracking-tight">TeamBoard</p>
        <Card>
          <CardHeader>
            <CardTitle>{props.title}</CardTitle>
            {props.description && <CardDescription>{props.description}</CardDescription>}
          </CardHeader>
          <CardContent className="space-y-4">{props.children}</CardContent>
        </Card>
      </div>
    </main>
  );
}
