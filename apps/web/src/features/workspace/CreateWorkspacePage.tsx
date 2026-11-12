import { useState, type ChangeEvent } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link, useNavigate } from 'react-router';
import { CheckIcon, XIcon } from 'lucide-react';
import { createWorkspaceSchema, slugSchema, suggestSlug } from '@teamboard/shared';
import { AppHeader } from '@/components/AppHeader';
import { FormError, FormField, fieldA11y } from '@/components/FormField';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useMe } from '@/features/auth/useMe';
import { applyServerErrors } from '@/lib/formErrors';
import { useDebounced } from '@/lib/useDebounced';
import { useCreateWorkspace, useSlugCheck } from './api';

/** /onboarding: journey J1, step "Create your workspace" (FR-WS-01, FR-WS-02). */
export function CreateWorkspacePage() {
  const navigate = useNavigate();
  const me = useMe().data;
  const createWs = useCreateWorkspace();
  const [slugTouched, setSlugTouched] = useState(false);

  const { register, control, setValue, handleSubmit, setError, formState } = useForm({
    resolver: zodResolver(createWorkspaceSchema),
    defaultValues: { name: '', slug: '' },
  });
  const { errors } = formState;
  const slug = useWatch({ control, name: 'slug' });

  // Live availability check, only for slugs that pass the shared rules.
  const deferredSlug = useDebounced(slug, 300);
  const slugValid = slugSchema.safeParse(deferredSlug).success;
  const check = useSlugCheck(slugValid ? deferredSlug : '');

  const nameField = register('name', {
    // Suggest the slug from the name until the user edits the slug themselves.
    onChange: (e: ChangeEvent<HTMLInputElement>) => {
      if (!slugTouched) setValue('slug', suggestSlug(e.target.value), { shouldValidate: false });
    },
  });
  const slugField = register('slug', { onChange: () => setSlugTouched(true) });

  const onSubmit = handleSubmit(async (v) => {
    try {
      const { workspace } = await createWs.mutateAsync(v);
      navigate(`/w/${workspace.slug}`, { replace: true });
    } catch (e) {
      // SLUG_TAKEN (a race with someone else) goes under the URL; anything else on top.
      applyServerErrors(e, setError, { SLUG_TAKEN: 'slug' });
    }
  });

  const first = me?.workspaces.length === 0;

  return (
    <>
      <AppHeader />
      <main className="mx-auto max-w-lg p-4 sm:p-8">
        <Card>
          <CardHeader>
            <CardTitle>{first ? 'Create your first workspace' : 'Create a workspace'}</CardTitle>
            <CardDescription>
              A workspace is your team's home: its members, projects and boards.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={onSubmit} className="space-y-4" noValidate>
              <FormField id="name" label="Workspace name" error={errors.name?.message}>
                <Input
                  {...fieldA11y('name', errors.name?.message)}
                  placeholder="Acme Studio"
                  autoFocus
                  {...nameField}
                />
              </FormField>

              <FormField id="slug" label="URL" error={errors.slug?.message}>
                <div className="flex items-center rounded-md border focus-within:ring-2 focus-within:ring-ring/50">
                  <span className="pl-3 text-sm text-muted-foreground select-none">/w/</span>
                  <Input
                    {...fieldA11y('slug', errors.slug?.message)}
                    className="border-0 pl-0.5 shadow-none focus-visible:ring-0"
                    autoComplete="off"
                    spellCheck={false}
                    {...slugField}
                  />
                </div>
              </FormField>
              {!errors.slug && slugValid && check.data && (
                <p
                  className={
                    check.data.available
                      ? 'flex items-center gap-1 text-sm text-green-700'
                      : 'flex items-center gap-1 text-sm text-destructive'
                  }
                  aria-live="polite"
                >
                  {check.data.available ? (
                    <CheckIcon className="size-4" />
                  ) : (
                    <XIcon className="size-4" />
                  )}
                  {check.data.available
                    ? `teamboard.app/w/${deferredSlug} is available`
                    : (check.data.reason ?? 'That URL is taken')}
                </p>
              )}

              <FormError message={errors.root?.message} />
              <div className="flex items-center justify-between gap-3 pt-2">
                {!first ? (
                  <Link
                    to="/workspaces?all=1"
                    className="text-sm text-muted-foreground hover:underline"
                  >
                    Cancel
                  </Link>
                ) : (
                  <span />
                )}
                <Button type="submit" disabled={formState.isSubmitting}>
                  {formState.isSubmitting ? 'Creating…' : 'Create workspace'}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </main>
    </>
  );
}
