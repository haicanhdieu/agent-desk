import type { AgentDto, RuleDto, SkillDto } from '@agentdesk/contracts';
import { describe, expect, it } from 'vitest';
import { ruleStats, ruleSummary, rulesUsing, skillFileHref, toRule, toRuleAgentOption, toSkill } from './map';

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
  model: null,
  kind: 'skill',
  skillName,
  prompt: null,
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
  baseUrl: null,
  maxTurns: null,
  timeoutSeconds: 1800,
  pausedKeepSeconds: 604800,
  doneKeepSeconds: 86400,
  idleEndSeconds: 1800,
  autoResumeMax: 5,
  credential: { set: true, type: 'oauth_token', updatedAt: null, setBy: null },
  accountLabel: null,
  isDefault: true,
  lastTest: null,
  usage: { rules: 0, blockingRuns: 0 },
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
    expect(toRule(dto, [agent], now, ['code-build'])).toEqual({
      kind: 'skill',
      id: dto.id,
      command: 'code-build',
      target: 'issue',
      labels: ['user-story'],
      skill: 'code-build',
      agentId: '00000000-0000-4000-8000-000000000002',
      agentLabel: 'Claude',
      model: null,
      enabled: true,
      stats: 'Never ran',
    });
  });

  it('warns when the skill is not in the repo, naming no folder until the folders are known', () => {
    expect(toRule(rule('docs-update', 'docs-update'), [agent], now, ['code-build']).warning).toBe(
      "Skill docs-update is not in the project's skill folders on main. Comments with /docs-update are ignored until you add it or pick another skill.",
    );
  });

  it('names the folders searched when the skill is missing', () => {
    expect(toRule(rule('docs-update', 'docs-update'), [agent], now, ['code-build'], ['.agents/skills']).warning).toBe(
      'Skill docs-update is not in .agents/skills/ on main. Comments with /docs-update are ignored until you add it or pick another skill.',
    );
    expect(
      toRule(rule('docs-update', 'docs-update'), [agent], now, ['code-build'], ['.claude/skills', '.agents/skills'])
        .warning,
    ).toContain('is not in .claude/skills/ or .agents/skills/ on main.');
  });

  it('maps a prompt rule with its kind and prompt and no skill warning', () => {
    const dto: RuleDto = { ...rule('triage', 'x'), kind: 'prompt', skillName: null, prompt: 'Triage this.\nBe brief.' };
    const mapped = toRule(dto, [agent], now, ['code-build']);
    expect(mapped).toMatchObject({ kind: 'prompt', prompt: 'Triage this.\nBe brief.', skill: '' });
    expect(mapped.warning).toBeUndefined();
  });

  it('a skill rule maps to kind skill with no prompt', () => {
    expect(toRule(rule('code-build', 'code-build'), [agent], now)).toMatchObject({
      kind: 'skill',
      skill: 'code-build',
    });
    expect(toRule(rule('code-build', 'code-build'), [agent], now).prompt).toBeUndefined();
  });

  it('no skill list, no warning', () => {
    expect(toRule(rule('docs-update', 'docs-update'), [agent], now).warning).toBeUndefined();
  });
});

describe('toRule agent', () => {
  const codex: AgentDto = {
    ...agent,
    id: '00000000-0000-4000-8000-0000000000c1',
    name: 'Codex - Work',
    provider: 'codex',
    isDefault: false,
  };
  const noCredential: AgentDto['credential'] = { set: false, type: null, updatedAt: null, setBy: null };
  const opencode: AgentDto = {
    ...agent,
    id: '00000000-0000-4000-8000-0000000000c2',
    name: 'OpenCode - Own',
    provider: 'opencode',
    isDefault: false,
    credential: noCredential,
  };
  const named = (a: AgentDto) => ({ ...rule('code-build', 'code-build'), agentId: a.id });

  it('a rule with no agent names none and follows the project default', () => {
    const mapped = toRule({ ...rule('code-build', 'code-build'), agentId: null }, [agent, codex], now);
    expect(mapped.agentId).toBeNull();
    expect(mapped.agentLabel).toBeUndefined();
    expect(mapped.warning).toBeUndefined();
  });

  it('a rule that names an agent shows a neutral label, not its id, while the agent list is loading', () => {
    const mapped = toRule(named(codex), undefined, now);
    expect(mapped.agentId).toBe(codex.id);
    expect(mapped.agentLabel).toBe('Loading agent…');
    expect(mapped.warning).toBeUndefined();
  });

  it('a rule whose agent is not in a ready list reads Unavailable agent', () => {
    expect(toRule(named(codex), [agent], now).agentLabel).toBe('Unavailable agent');
  });

  it('a rule shows the name of the agent it names', () => {
    expect(toRule(named(codex), [agent, codex], now).agentLabel).toBe('Codex - Work');
  });

  it.each([
    ['a credential that is missing on a kind that needs one', { ...codex, credential: noCredential }, true],
    [
      'a rejected credential',
      { ...codex, lastTest: { status: 'rejected' as const, at: '2026-11-11T10:00:00.000Z' } },
      true,
    ],
    ['an OpenCode agent with no credential', opencode, false],
    ['a working credential', { ...codex, lastTest: { status: 'ok' as const, at: '2026-11-11T10:00:00.000Z' } }, false],
    [
      'an unreachable address',
      { ...codex, lastTest: { status: 'unreachable' as const, at: '2026-11-11T10:00:00.000Z' } },
      false,
    ],
  ])('warns for %s: %s', (_, a, warns) => {
    const warning = toRule(named(a), [agent, a], now).warning;
    if (warns) expect(warning).toBe(`${a.name} has no working credential. Runs from this rule will fail.`);
    else expect(warning).toBeUndefined();
  });

  it('keeps the skill warning next to the agent warning', () => {
    const a = { ...codex, credential: noCredential };
    const dto = { ...named(a), skillName: 'docs-update' };
    expect(toRule(dto, [a], now, ['code-build']).warning).toMatch(/Skill docs-update is not in .*Codex - Work has no/);
  });

  it('toRuleAgentOption reads the connection from the credential and the last test', () => {
    expect(toRuleAgentOption({ ...codex, credential: noCredential })).toMatchObject({
      id: codex.id,
      label: 'Codex - Work',
      provider: 'codex',
      model: 'opus',
      connection: 'no_credential',
    });
    expect(
      toRuleAgentOption({ ...codex, lastTest: { status: 'rejected', at: '2026-11-11T10:00:00.000Z' } }).connection,
    ).toBe('rejected');
    expect(toRuleAgentOption(codex).connection).toBeUndefined();
  });

  it('toRuleAgentOption marks kinds that need a credential (OpenCode does not)', () => {
    expect(toRuleAgentOption(codex).needsCredential).toBe(true);
    expect(toRuleAgentOption({ ...codex, provider: 'opencode' }).needsCredential).toBe(false);
  });
});

describe('skillFileHref', () => {
  // The API's provider-specific prefix already ends at the project's default branch.
  const base = 'https://git.example.com/acme/app/blob/release/1.2/';

  it('appends the selected skill path to the connected repo file prefix', () => {
    expect(skillFileHref(base, '.claude/skills/a b/SKILL.md')).toBe(
      'https://git.example.com/acme/app/blob/release/1.2/.claude/skills/a%20b/SKILL.md',
    );
  });

  it('works for a provider whose file prefix differs from GitHub', () => {
    expect(skillFileHref('https://git.example.com/acme/app/-/blob/main/', '.agents/skills/code-build/SKILL.md')).toBe(
      'https://git.example.com/acme/app/-/blob/main/.agents/skills/code-build/SKILL.md',
    );
  });

  it('drops traversal and empty path segments', () => {
    expect(skillFileHref(base, './foo/../.claude//SKILL.md')).toBe(
      'https://git.example.com/acme/app/blob/release/1.2/foo/.claude/SKILL.md',
    );
  });

  it('has no link when the prefix is unknown', () => {
    expect(skillFileHref(null, '.claude/skills/code-build/SKILL.md')).toBeUndefined();
    expect(skillFileHref(undefined, '.claude/skills/code-build/SKILL.md')).toBeUndefined();
  });

  it('has no link when the prefix is not a safe http(s) URL', () => {
    expect(skillFileHref('javascript:alert(1)', '.claude/SKILL.md')).toBeUndefined();
  });

  it('has no link when the prefix carries credentials', () => {
    expect(skillFileHref('https://token@git.example.com/acme/app/blob/main/', '.claude/SKILL.md')).toBeUndefined();
  });
});
