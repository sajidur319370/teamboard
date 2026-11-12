import { Loader2Icon } from 'lucide-react';

export function FullPageSpinner() {
  return (
    <div className="grid h-screen place-items-center text-muted-foreground" aria-busy="true">
      <Loader2Icon className="size-6 animate-spin" aria-label="Loading" />
    </div>
  );
}
