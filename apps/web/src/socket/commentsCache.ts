// Pure patchers for the comments infinite query (no React, no network), unit-tested.
// Used by this tab's mutations AND by socket events from other people.
import type { InfiniteData } from '@tanstack/react-query';
import type { CommentDto, Page } from '@teamboard/shared';

export type CommentPages = InfiniteData<Page<CommentDto>>;

const has = (d: CommentPages, id: string) => d.pages.some((p) => p.items.some((c) => c.id === id));

/**
 * Adds a comment to the LAST loaded page, once. If newer pages aren't loaded yet, the same
 * comment comes back with "Load more"; `flattenComments` drops that duplicate.
 */
export function appendComment(d: CommentPages | undefined, c: CommentDto) {
  if (!d || d.pages.length === 0 || has(d, c.id)) return d;
  const pages = [...d.pages];
  const last = pages.at(-1)!;
  pages[pages.length - 1] = { ...last, items: [...last.items, c] };
  return { ...d, pages };
}

export function replaceComment(d: CommentPages | undefined, c: CommentDto) {
  if (!d || !has(d, c.id)) return d;
  return {
    ...d,
    pages: d.pages.map((p) => ({ ...p, items: p.items.map((x) => (x.id === c.id ? c : x)) })),
  };
}

export function removeComment(d: CommentPages | undefined, id: string) {
  if (!d || !has(d, id)) return d;
  return { ...d, pages: d.pages.map((p) => ({ ...p, items: p.items.filter((x) => x.id !== id) })) };
}

/** All loaded comments, oldest first, each once: the same (createdAt, id) order as the API. */
export function flattenComments(d: CommentPages | undefined): CommentDto[] {
  const byId = new Map<string, CommentDto>();
  for (const p of d?.pages ?? []) for (const c of p.items) byId.set(c.id, c);
  return [...byId.values()].sort(
    (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
  );
}
