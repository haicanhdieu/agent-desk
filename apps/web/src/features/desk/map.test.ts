import type { AgentDto, RuleDto, SkillDto } from '@agentdesk/contracts';
import { describe, expect, it } from 'vitest';
import { ruleStats, ruleSummary, rulesUsing, toRule, toSkill } from './map';

const now = new Date('2026-11-12T14:14:00.000Z');

const skill: SkillDto = {
  name: 'code-build',
  description: 'Implement a user story.',
  path: '.claude/skills/code-build/SKILL.md',
  lastCommit: { sha: 'a91c3e2f00d', message: 'Add agent skills', at: '2026-11-12T14:12:00.000Z' },
  body: '# code-build\n',
  sha: 'blob-1',
};

const rule = (command: string, skillName: string, enabled = true): RuleDto => ({
  id: `00000000-0000-4000-8000-${command.padStart(12, '0').slice(-12)}`,
  projectId: '00000000-0000-4000-8000-000000000001',
  command,
  labelFilter: [],
  target: 'any',
  agentId: '00000000-0000-4000-8000-000000000002',
  skillName,
  enabled,
  stats: { runs30d: 0, lastRunAt: null },
});

describe('ruleSummary', () => {
  it.each([
    ['no rule', [], 'No rules'],
    ['one enabled', [rule('a', 'code-build')], '1 rule'],
    ['two enabled', [rule('a', 'code-build'), rule('b', 'code-build')], '2 rules'],
    ['one, off', [rule('a', 'code-build', false)], '1 rule, off'],
    ['two, both off', [rule('a', 'code-build', false), rule('b', 'code-build', false)], '2 rules, off'],
    ['two, one off', [rule('a', 'code-build'), rule('b', 'code-build', false)], '2 rules, 1 off'],
    ['other skills ignored', [rule('a', 'other'), rule('b', 'code-build')], '1 rule'],
  ])('%s', (_, rules, expected) => {
    expect(ruleSummary('code-build', rules)).toBe(expected);
  });
});

describe('rulesUsing', () => {
  it('lists the commands of rules using the skill, slash-prefixed', () => {
    expect(rulesUsing('code-build', [rule('a', 'code-build'), rule('b', 'x'), rule('c', 'code-build', false)])).toEqual(
      ['/a', '/c'],
    );
  });
});

describe('toSkill', () => {
  it('maps a skill with its rules and last commit as "short sha, relative"', () => {
    expect(toSkill(skill, [rule('code-build', 'code-build')], now)).toEqual({
      name: 'code-build',
      description: 'Implement a user story.',
      body: '# code-build\n',
      path: '.claude/skills/code-build/SKILL.md',
      ruleSummary: '1 rule',
      lastCommit: 'a91c3e2, 2 min ago',
    });
  });

  it('a summary without a body maps to an empty body', () => {
    const summary = { name: skill.name, description: skill.description, path: skill.path, lastCommit: null };
    expect(toSkill(summary, [], now).body).toBe('');
  });

  it('no commit yet gives an empty last commit', () => {
    expect(toSkill({ ...skill, lastCommit: null }, [], now).lastCommit).toBe('');
  });
});

const agent: AgentDto = {
  id: '00000000-0000-4000-8000-000000000002',
  projectId: '00000000-0000-4000-8000-000000000001',
  name: 'Claude',
  provider: 'claude',
  model: 'opus',
  maxTurns: null,
  timeoutSeconds: 1800,
  credential: { set: true, type: 'oauth_token', updatedAt: null, setBy: null },
};

describe('ruleStats', () => {
  it.each([
    ['runs, last run', { runs30d: 14, lastRunAt: '2026-11-12T14:12:00.000Z' }, '14 runs in 30 days · last 2 min ago'],
    ['one run', { runs30d: 1, lastRunAt: '2026-11-11T10:00:00.000Z' }, '1 run in 30 days · last yesterday'],
    ['none in 30 days', { runs30d: 0, lastRunAt: '2026-10-03T16:00:00.000Z' }, '0 runs in 30 days · last 3 Oct'],
    ['never ran', { runs30d: 0, lastRunAt: null }, 'Never ran'],
  ])('%s', (_, stats, expected) => {
    expect(ruleStats(stats, now)).toBe(expected);
  });
});

describe('toRule', () => {
  it('maps the DTO to the screen rule with the agent name and stats', () => {
    const dto = { ...rule('code-build', 'code-build'), labelFilter: ['user-story'], target: 'issue' as const };
    expect(toRule(dto, agent, now, ['code-build'])).toEqual({
      id: dto.id,
      command: 'code-build',
      target: 'issue',
      labels: ['user-story'],
      skill: 'code-build',
      agent: 'Claude',
      enabled: true,
      stats: 'Never ran',
    });
  });

  it('warns when the skill is not in the repo', () => {
    expect(toRule(rule('docs-update', 'docs-update'), agent, now, ['code-build']).warning).toBe(
      'Skill docs-update is not in .claude/skills/ on main. Comments with /docs-update are ignored until you add it or pick another skill.',
    );
  });

  it('no skill list, no warning', () => {
    expect(toRule(rule('docs-update', 'docs-update'), agent, now).warning).toBeUndefined();
  });
});
