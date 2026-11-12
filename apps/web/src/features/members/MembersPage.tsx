import { useNavigate } from 'react-router';
import type { ChangeRoleInput, MemberDto } from '@teamboard/shared';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { UserAvatar } from '@/components/UserAvatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useMe } from '@/features/auth/useMe';
import { Can, useCan, useWorkspace } from '@/features/workspace/WorkspaceContext';
import {
  useChangeRole,
  useLeaveWorkspace,
  useMembers,
  useRemoveMember,
} from '@/features/workspace/api';
import { ROLE_LABEL, shortDate } from '@/lib/format';
import { forgetWorkspace } from '@/lib/lastWorkspace';
import { InviteDialog } from './InviteDialog';
import { InvitesList } from './InvitesList';
import { memberActions } from './memberRules';

export function MembersPage() {
  const { workspace } = useWorkspace();
  const members = useMembers(workspace.slug);

  return (
    <div className="max-w-3xl p-4 sm:p-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Members</h1>
          {members.data && (
            <p className="text-sm text-muted-foreground">
              {members.data.length} {members.data.length === 1 ? 'person' : 'people'}
            </p>
          )}
        </div>
        <Can perm="invite:create">
          <InviteDialog />
        </Can>
      </div>

      {members.isPending ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      ) : members.error ? (
        <p className="text-destructive">{members.error.message}</p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {members.data.map((m) => (
            <MemberRow key={m.userId} member={m} />
          ))}
        </ul>
      )}

      <Can perm="invite:view">
        <InvitesList />
      </Can>

      <LeaveSection />
    </div>
  );
}

function MemberRow({ member: m }: { member: MemberDto }) {
  const { workspace, role: myRole } = useWorkspace();
  const can = useCan();
  const myId = useMe().data!.user.id;
  const changeRole = useChangeRole(workspace.slug);
  const remove = useRemoveMember(workspace.slug);
  const a = memberActions(myRole, myId, m);
  const mayChangeRole = can('member:updateRole') && a.canChangeRole;
  const mayRemove = can('member:remove') && a.canRemove;

  return (
    <li className="flex flex-wrap items-center gap-3 p-3">
      <UserAvatar name={m.name} color={m.avatarColor} className="size-9" />
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">
          {m.name} {a.isMe && <span className="font-normal text-muted-foreground">(you)</span>}
        </p>
        <p className="truncate text-sm text-muted-foreground">
          {m.email} · joined {shortDate(m.joinedAt)}
        </p>
      </div>

      {mayChangeRole ? (
        <Select
          value={m.role}
          onValueChange={(role) =>
            changeRole.mutate({ userId: m.userId, role: role as ChangeRoleInput['role'] })
          }
          disabled={changeRole.isPending}
        >
          <SelectTrigger className="w-32" aria-label={`Role of ${m.name}`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {a.roleOptions.map((r) => (
              <SelectItem key={r} value={r}>
                {ROLE_LABEL[r]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <Badge variant={m.role === 'owner' ? 'default' : 'secondary'}>{ROLE_LABEL[m.role]}</Badge>
      )}

      {mayRemove && (
        <ConfirmDialog
          trigger={
            <Button variant="ghost" size="sm" aria-label={`Remove ${m.name}`}>
              Remove
            </Button>
          }
          title={`Remove ${m.name}?`}
          description={`They lose access to ${workspace.name} immediately. Tasks assigned to them keep the assignment.`}
          confirmLabel="Remove"
          destructive
          onConfirm={() => remove.mutateAsync(m.userId)}
        />
      )}
    </li>
  );
}

function LeaveSection() {
  const { workspace, role } = useWorkspace();
  const navigate = useNavigate();
  const leave = useLeaveWorkspace(workspace.slug);

  return (
    <section className="mt-10 rounded-lg border p-4" aria-labelledby="leave-heading">
      <h2 id="leave-heading" className="font-semibold">
        Leave workspace
      </h2>
      {role === 'owner' ? (
        // BR-04: the Owner can't leave; the API answers 409 OWNER_MUST_TRANSFER anyway.
        <p className="mt-1 text-sm text-muted-foreground">
          You're the owner. Transfer ownership in Settings before you can leave.
        </p>
      ) : (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            You'll lose access to {workspace.name} until someone invites you again.
          </p>
          <ConfirmDialog
            trigger={<Button variant="destructive">Leave</Button>}
            title={`Leave ${workspace.name}?`}
            description="You'll need a new invite to come back."
            confirmLabel="Leave workspace"
            destructive
            onConfirm={async () => {
              await leave.mutateAsync();
              forgetWorkspace(workspace.slug);
              navigate('/workspaces?all=1', { replace: true });
            }}
          />
        </div>
      )}
    </section>
  );
}
