/**
 * Every TanStack Query cache key lives here.
 * Every workspace key starts with ['w', slug], so invalidating ['w', slug] refetches
 * EVERYTHING for that workspace (handy after a role change, or a reconnect on Day 15).
 */
export const qk = {
  me: ['me'] as const,
  slugCheck: (slug: string) => ['slug-check', slug] as const,
  invitePreview: (token: string) => ['invite', token] as const,
  workspace: (slug: string) => ['w', slug] as const,
  members: (slug: string) => ['w', slug, 'members'] as const,
  invites: (slug: string) => ['w', slug, 'invites'] as const,
  projects: (slug: string) => ['w', slug, 'projects'] as const,
  /** Prefix of every board view of one project, for invalidation. */
  boardAll: (slug: string, key: string) => ['w', slug, 'board', key] as const,
  board: (slug: string, key: string, sprint: string) => ['w', slug, 'board', key, sprint] as const,
  task: (slug: string, key: string, number: number) => ['w', slug, 'task', key, number] as const,
  myTasks: (slug: string) => ['w', slug, 'my-tasks'] as const,
};
