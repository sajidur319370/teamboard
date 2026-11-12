import { Link } from 'react-router';
import { Button } from '@/components/ui/button';

export function NotFoundPage({ message = "We couldn't find that page." }: { message?: string }) {
  return (
    <main className="grid min-h-screen place-items-center p-4 text-center">
      <div className="space-y-4">
        <p className="text-5xl font-bold">404</p>
        <p className="text-muted-foreground">{message}</p>
        <Button asChild>
          <Link to="/workspaces?all=1">Go to your workspaces</Link>
        </Button>
      </div>
    </main>
  );
}
