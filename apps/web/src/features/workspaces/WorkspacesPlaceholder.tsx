import { AppHeader } from '@/components/AppHeader';
import { useMe } from '@/features/auth/useMe';

/** Stand-in for /workspaces until Day 7 builds the real list and onboarding. */
export function WorkspacesPlaceholder() {
  const { data } = useMe();
  return (
    <>
      <AppHeader />
      <main className="p-8">
        <h1 className="text-2xl font-bold tracking-tight">Hi {data?.user.name} 👋</h1>
        <p className="mt-2 text-muted-foreground">Workspaces arrive on Day 7.</p>
      </main>
    </>
  );
}
