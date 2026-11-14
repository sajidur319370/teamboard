import { Component, type ErrorInfo, type ReactNode } from 'react';
import { useLocation } from 'react-router';
import { Button } from '@/components/ui/button';

/** A lazy chunk that no longer exists: the app was redeployed while this tab was open. */
const isStaleChunk = (e: Error) =>
  /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i.test(
    e.message,
  );

class Boundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  override state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Render error', error, info.componentStack);
  }

  override render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const stale = isStaleChunk(error);
    return (
      <div
        role="alert"
        className="flex min-h-[60vh] flex-col items-center justify-center gap-3 p-6 text-center"
      >
        <h1 className="text-xl font-semibold">
          {stale ? 'A new version is available' : 'Something went wrong'}
        </h1>
        <p className="max-w-md text-sm text-muted-foreground">
          {stale
            ? 'TeamBoard was updated while this tab was open. Reload to get the latest version.'
            : 'This part of the page crashed. Your saved work is safe: reloading usually fixes it.'}
        </p>
        <div className="flex gap-2">
          <Button onClick={() => window.location.reload()}>Reload</Button>
          <Button variant="outline" onClick={() => window.location.assign('/workspaces')}>
            Go to my workspaces
          </Button>
        </div>
      </div>
    );
  }
}

/**
 * Catches render errors anywhere below it. Keyed on the URL, so navigating away from a
 * crashed page gives the next page a fresh start instead of the same error screen.
 */
export function ErrorBoundary({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  return <Boundary key={pathname}>{children}</Boundary>;
}
