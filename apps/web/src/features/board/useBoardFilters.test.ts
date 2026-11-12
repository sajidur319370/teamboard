import { describe, expect, it } from 'vitest';
import { hasFilters, matches, parseFilters } from './useBoardFilters';

const task = (assigneeIds: string[], priority = 'none', labelIds: string[] = []) => ({
  assigneeIds,
  priority: priority as 'none',
  labelIds,
});

describe('board filters', () => {
  it('parse from the URL; repeated priority params become a list', () => {
    const f = parseFilters(
      new URLSearchParams('mine=1&priority=high&priority=urgent&label=L1&sprint=active'),
    );
    expect(f).toEqual({ assignee: null, priority: ['high', 'urgent'], label: 'L1', mine: true });
    expect(hasFilters(f)).toBe(true);
    expect(hasFilters(parseFilters(new URLSearchParams('sprint=active')))).toBe(false); // sprint isn't a filter
  });

  it('every active filter must match (AND)', () => {
    const f = parseFilters(new URLSearchParams('mine=1&priority=high'));
    const pass = matches(f, 'me');
    expect(pass(task(['me'], 'high'))).toBe(true);
    expect(pass(task(['me'], 'low'))).toBe(false);
    expect(pass(task(['you'], 'high'))).toBe(false);
  });

  it('assignee and label filters', () => {
    const pass = matches(parseFilters(new URLSearchParams('assignee=u2&label=L1')), 'me');
    expect(pass(task(['u1', 'u2'], 'none', ['L1', 'L2']))).toBe(true);
    expect(pass(task(['u1'], 'none', ['L1']))).toBe(false);
    expect(pass(task(['u2'], 'none', []))).toBe(false);
  });

  it('no filters: everything passes', () => {
    expect(matches(parseFilters(new URLSearchParams()), 'me')(task([]))).toBe(true);
  });
});
