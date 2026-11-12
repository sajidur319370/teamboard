import type { ReactNode } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

/** The centered card every auth page sits in. */
export function AuthCard(props: { title: string; description?: string; children: ReactNode }) {
  return (
    <main className="grid min-h-screen place-items-center bg-muted/40 p-4">
      <div className="w-full max-w-sm space-y-6">
        <p className="text-center text-xl font-bold tracking-tight">TeamBoard</p>
        <Card>
          <CardHeader>
            <CardTitle>{props.title}</CardTitle>
            {props.description && <CardDescription>{props.description}</CardDescription>}
          </CardHeader>
          <CardContent>{props.children}</CardContent>
        </Card>
      </div>
    </main>
  );
}
