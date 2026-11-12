import { describe, expect, it } from 'vitest';
import { safeReturnTo } from './safeReturnTo';

describe('safeReturnTo', () => {
  it.each([
    ['/profile', '/profile'],
    ['/w/acme/p/MOB/board?sprint=active', '/w/acme/p/MOB/board?sprint=active'],
    [null, '/workspaces'],
    ['', '/workspaces'],
    ['https://evil.com', '/workspaces'],
    ['//evil.com', '/workspaces'],
    ['/\\evil.com', '/workspaces'],
    ['javascript:alert(1)', '/workspaces'],
  ])('%s → %s', (input, expected) => {
    expect(safeReturnTo(input)).toBe(expected);
  });
});
