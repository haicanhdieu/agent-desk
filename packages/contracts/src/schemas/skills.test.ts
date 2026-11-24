import { describe, expect, it } from 'vitest';
import { routes } from '../routes';
import { SkillChangeResponse } from './skills';

describe('SkillChangeResponse', () => {
  it('accepts a direct commit with its target branch', () => {
    const commit = { kind: 'commit', commitSha: 'abc', targetBranch: 'main' };
    expect(SkillChangeResponse.parse(commit)).toEqual(commit);
  });

  it('accepts a change request with branches, url and id', () => {
    const cr = {
      kind: 'change_request',
      sourceBranch: 'agent-desk/skill-update-x',
      targetBranch: 'main',
      url: 'https://example.com/pr/1',
      id: '1',
    };
    expect(SkillChangeResponse.parse(cr)).toEqual(cr);
  });

  it('rejects a change request without a url and an unknown kind', () => {
    expect(
      SkillChangeResponse.safeParse({ kind: 'change_request', sourceBranch: 'a', targetBranch: 'b' }).success,
    ).toBe(false);
    expect(SkillChangeResponse.safeParse({ kind: 'merged' }).success).toBe(false);
  });

  it('is the response of both put and remove', () => {
    const commit = { kind: 'commit', commitSha: 'a', targetBranch: 'main' };
    expect(routes.skills.put.response.safeParse(commit).success).toBe(true);
    expect(routes.skills.remove.response.safeParse(commit).success).toBe(true);
    expect(routes.skills.remove.response.safeParse(null).success).toBe(false);
  });
});
