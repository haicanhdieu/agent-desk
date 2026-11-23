import { describe, expect, it } from 'vitest';
import type { Query } from '@tanstack/react-query';
import { auditQuery } from './queries';

const PAGE = { items: [], page: 1, pageSize: 20, total: 0 };

// The placeholder rule on its own, apart from the route's `key={org}` remount (BR-25).
function placeholder(org: string, previousOrg: string) {
  const fn = auditQuery(org, 'org-id', { page: 2, pageSize: 20 }).placeholderData;
  if (typeof fn !== 'function') throw new Error('placeholderData must be a function');
  const previousQuery = { queryKey: ['org', previousOrg, 'audit', 'list', 1, 20] } as unknown as Query;
  return (fn as (p: unknown, q: Query | undefined) => unknown)(PAGE, previousQuery);
}

describe('auditQuery placeholderData', () => {
  it('keeps the previous page of the same org', () => {
    expect(placeholder('harbor', 'harbor')).toBe(PAGE);
  });
  it("never shows another org's rows while loading", () => {
    expect(placeholder('harbor', 'other')).toBeUndefined();
  });
});
