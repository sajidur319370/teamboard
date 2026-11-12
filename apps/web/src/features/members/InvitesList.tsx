import { LockIcon } from 'lucide-react';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useWorkspace } from '@/features/workspace/WorkspaceContext';
import { useInvites, useMembers, useRevokeInvite } from '@/features/workspace/api';
import { ROLE_LABEL, relativeTime } from '@/lib/format';
import { canRevokeInvite } from './memberRules';

/** FR-INV-03/04: active invites with uses, expiry and a Revoke button. */
export function InvitesList() {
  const { workspace, role: myRole } = useWorkspace();
  const invites = useInvites(workspace.slug);
  const members = useMembers(workspace.slug); // already cached by the page: names for "created by"
  const revoke = useRevokeInvite(workspace.slug);
  const nameOf = (userId: string) =>
    members.data?.find((m) => m.userId === userId)?.name ?? 'a former member';

  return (
    <section className="mt-10" aria-labelledby="invites-heading">
      <h2 id="invites-heading" className="mb-3 text-lg font-semibold">
        Active invite links
      </h2>
      {invites.isPending ? (
        <Skeleton className="h-16 w-full" />
      ) : invites.data?.length === 0 ? (
        <p className="text-sm text-muted-foreground">No active invites.</p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {invites.data?.map((i) => (
            <li
              key={i.id}
              className="flex flex-wrap items-center justify-between gap-3 p-3 text-sm"
            >
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary">{ROLE_LABEL[i.role]}</Badge>
                  {i.email && (
                    <span className="flex items-center gap-1 text-muted-foreground">
                      <LockIcon className="size-3" /> {i.email}
                    </span>
                  )}
                </div>
                <p className="text-muted-foreground">
                  {i.uses}/{i.maxUses} used · expires {relativeTime(i.expiresAt)} · by{' '}
                  {nameOf(i.createdBy)}
                </p>
              </div>
              {canRevokeInvite(myRole, i) && (
                <ConfirmDialog
                  trigger={
                    <Button variant="ghost" size="sm">
                      Revoke
                    </Button>
                  }
                  title="Revoke this invite link?"
                  description="Anyone holding the link won't be able to join with it any more."
                  confirmLabel="Revoke"
                  destructive
                  onConfirm={() => revoke.mutateAsync(i.id)}
                />
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
