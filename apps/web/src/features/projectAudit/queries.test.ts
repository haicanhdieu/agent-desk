import { describe, expect, it } from 'vitest';
import type { Query } from '@tanstack/react-query';
import { projectAuditListKey, projectAuditQuery } from './queries';

const PAGE = { items: [], page: 1, pageSize: 20, total: 0 };

describe('projectAuditQuery', () => {
  it('keys the list under the org and project, then page and page size', () => {
    expect(projectAuditListKey('harbor', 'p1')).toEqual(['org', 'harbor', 'projects', 'p1', 'audit', 'list']);
    expect(projectAuditQuery('harbor', 'p1', { page: 2, pageSize: 50 }).queryKey).toEqual([
      'org',
      'harbor',
      'projects',
      'p1',
      'audit',
      'list',
      2,
      50,
    ]);
  });

  it("keeps the previous page of the same project and never another project's rows", () => {
    const fn = projectAuditQuery('harbor', 'p1', { page: 2, pageSize: 20 }).placeholderData;
    if (typeof fn !== 'function') throw new Error('placeholderData must be a function');
    const run = (org: string, project: string) =>
      (fn as (p: unknown, q: Query | undefined) => unknown)(PAGE, {
        queryKey: ['org', org, 'projects', project, 'audit', 'list', 1, 20],
      } as unknown as Query);
    expect(run('harbor', 'p1')).toBe(PAGE);
    expect(run('harbor', 'p2')).toBeUndefined();
    expect(run('other', 'p1')).toBeUndefined();
  });
});
