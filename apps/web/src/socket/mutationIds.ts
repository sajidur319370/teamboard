// Ids of mutations THIS tab sent. Day 15: socket events carrying one of these are our own
// echo, so the client ignores them (it already applied the change optimistically).
const mine = new Set<string>();

export function newMutationId(): string {
  const id = crypto.randomUUID();
  mine.add(id);
  setTimeout(() => mine.delete(id), 60_000); // don't grow forever
  return id;
}

export const isOwnMutation = (id?: string | null) => !!id && mine.has(id);
