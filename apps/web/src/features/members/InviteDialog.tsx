import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { CopyIcon, UserPlusIcon } from 'lucide-react';
import { toast } from 'sonner';
import { INVITE_EXPIRY_DAYS, createInviteSchema, grantableRoles } from '@teamboard/shared';
import { FormError, FormField, fieldA11y } from '@/components/FormField';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useWorkspace } from '@/features/workspace/WorkspaceContext';
import { useCreateInvite } from '@/features/workspace/api';
import { applyServerErrors } from '@/lib/formErrors';
import { ROLE_HINT, ROLE_LABEL } from '@/lib/format';

const DEFAULTS = { role: 'member', expiresInDays: 7, maxUses: 10, email: null } as const;

/** FR-INV-01/02: create a link, then show it ONCE with a copy button. */
export function InviteDialog() {
  const { workspace, role: myRole } = useWorkspace();
  const create = useCreateInvite(workspace.slug);
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const roles = grantableRoles(myRole); // an Admin never sees "admin" (FR-RBAC-02)

  const { register, control, handleSubmit, setError, reset, formState } = useForm({
    resolver: zodResolver(createInviteSchema),
    defaultValues: DEFAULTS,
  });
  const { errors } = formState;

  const onSubmit = handleSubmit((v) =>
    create
      .mutateAsync(v)
      .then((r) => setUrl(r.url))
      .catch((e: unknown) => applyServerErrors(e, setError)),
  );

  const close = (next: boolean) => {
    setOpen(next);
    if (!next) {
      setUrl(null);
      reset(DEFAULTS);
    }
  };

  const copy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      toast.success('Link copied');
    } catch {
      toast.error("Couldn't copy. Select the link and copy it yourself.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogTrigger asChild>
        <Button>
          <UserPlusIcon /> Invite
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {url ? 'Share this link' : `Invite people to ${workspace.name}`}
          </DialogTitle>
          <DialogDescription>
            {url
              ? "This link is shown only once. Copy it now; you can't see it again later."
              : 'Anyone with the link can join with the role you choose.'}
          </DialogDescription>
        </DialogHeader>

        {url ? (
          <div className="space-y-4">
            <div className="flex gap-2">
              <Input
                readOnly
                value={url}
                aria-label="Invite link"
                onFocus={(e) => e.currentTarget.select()}
              />
              <Button onClick={copy} variant="outline" aria-label="Copy link">
                <CopyIcon /> Copy
              </Button>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setUrl(null)}>
                Create another
              </Button>
              <Button onClick={() => close(false)}>Done</Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-4" noValidate>
            <FormField id="invite-role" label="Role" error={errors.role?.message}>
              <Controller
                control={control}
                name="role"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id="invite-role" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {roles.map((r) => (
                        <SelectItem key={r} value={r}>
                          <span className="font-medium">{ROLE_LABEL[r]}</span>
                          <span className="text-muted-foreground"> · {ROLE_HINT[r]}</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </FormField>

            <div className="grid grid-cols-2 gap-3">
              <FormField
                id="invite-expiry"
                label="Expires in"
                error={errors.expiresInDays?.message}
              >
                <Controller
                  control={control}
                  name="expiresInDays"
                  render={({ field }) => (
                    <Select
                      value={String(field.value)}
                      onValueChange={(v) => field.onChange(Number(v))}
                    >
                      <SelectTrigger id="invite-expiry" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {INVITE_EXPIRY_DAYS.map((d) => (
                          <SelectItem key={d} value={String(d)}>
                            {d === 1 ? '1 day' : `${d} days`}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              </FormField>
              <FormField id="invite-uses" label="Max uses" error={errors.maxUses?.message}>
                <Input
                  {...fieldA11y('invite-uses', errors.maxUses?.message)}
                  type="number"
                  min={1}
                  max={50}
                  {...register('maxUses', { valueAsNumber: true })}
                />
              </FormField>
            </div>

            <FormField
              id="invite-email"
              label="Only for this email (optional)"
              error={errors.email?.message}
              hint="Leave empty so anyone with the link can join."
            >
              <Input
                {...fieldA11y('invite-email', errors.email?.message)}
                type="email"
                placeholder="rahim@example.com"
                {...register('email', { setValueAs: (v: string) => (v?.trim() ? v : null) })}
              />
            </FormField>

            <FormError message={errors.root?.message} />
            <DialogFooter>
              <Button type="submit" disabled={formState.isSubmitting}>
                {formState.isSubmitting ? 'Creating…' : 'Create link'}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
