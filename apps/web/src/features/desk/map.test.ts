import type { RuleDto, SkillDto } from '@agentdesk/contracts';
import { describe, expect, it } from 'vitest';
import { ruleSummary, rulesUsing, toSkill } from './map';

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
