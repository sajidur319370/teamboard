import { describe, expect, it } from 'vitest';
import type { CommentDto } from '@teamboard/shared';
import {
  appendComment,
  flattenComments,
  removeComment,
  replaceComment,
  type CommentPages,
} from './commentsCache';

const c = (id: string, at: string, body = id): CommentDto => ({
  id,
  taskId: 't1',
  author: { id: 'u1', name: 'Olivia', avatarColor: 'blue' },
  body,
  editedAt: null,
  createdAt: `2026-11-13T10:00:${at}.000Z`,
});
const pages = (...ps: { items: CommentDto[]; nextCursor: string | null }[]): CommentPages => ({
  pages: ps,
  pageParams: ps.map((_, i) => (i === 0 ? '' : `cur${i}`)),
});

describe('comments cache', () => {
  it('appends to the last page, once (own echo + socket event = still one)', () => {
    const d = pages(
      { items: [c('a', '01')], nextCursor: 'x' },
      { items: [c('b', '02')], nextCursor: null },
    );
    const once = appendComment(d, c('n', '09'))!;
    expect(once.pages[1]!.items.map((x) => x.id)).toEqual(['b', 'n']);
    expect(appendComment(once, c('n', '09'))).toBe(once);
  });

  it('does nothing before the query has loaded', () => {
    expect(appendComment(undefined, c('n', '09'))).toBeUndefined();
    expect(replaceComment(undefined, c('n', '09'))).toBeUndefined();
    expect(removeComment(undefined, 'n')).toBeUndefined();
  });

  it('replace and remove reach every copy; unknown ids leave the data untouched', () => {
    // 'n' was appended to page 1, then "Load more" brought it again in page 2.
    const d = pages(
      { items: [c('a', '01'), c('n', '09')], nextCursor: 'x' },
      { items: [c('b', '02'), c('n', '09')], nextCursor: null },
    );
    const edited = replaceComment(d, { ...c('n', '09'), body: 'edited' })!;
    expect(flattenComments(edited).find((x) => x.id === 'n')!.body).toBe('edited');
    const removed = removeComment(d, 'n')!;
    expect(flattenComments(removed).map((x) => x.id)).toEqual(['a', 'b']);
    expect(replaceComment(d, c('zz', '00'))).toBe(d);
    expect(removeComment(d, 'zz')).toBe(d);
  });

  it('flatten: oldest first, each once, ties by id (same order as the API)', () => {
    const d = pages(
      { items: [c('b', '01'), c('n', '09')], nextCursor: 'x' },
      { items: [c('a', '01'), c('c', '05'), c('n', '09')], nextCursor: null },
    );
    expect(flattenComments(d).map((x) => x.id)).toEqual(['a', 'b', 'c', 'n']);
    expect(flattenComments(undefined)).toEqual([]);
  });
});
