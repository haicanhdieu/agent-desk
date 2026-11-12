import type { RuleDto } from '@agentdesk/contracts';
import { ids } from './ids';

// Mirrors mocks/rules.ts (DeskRules). docs-update points at a skill that is not in the repo (warning derived client
// side); qa-e2e is turned off.
const rule = (
  id: string,
  command: string,
  target: RuleDto['target'],
  labelFilter: string[],
  enabled: boolean,
  stats: RuleDto['stats'],
): RuleDto => ({
  id,
  projectId: ids.project.invoicerApi,
  command,
  labelFilter,
  target,
  agentId: ids.agent.invoicerApi,
  skillName: command,
  enabled,
  stats,
});

export const ruleFixtures: RuleDto[] = [
  rule(ids.rule.r1, 'code-build', 'issue', ['user-story'], true, {
    runs30d: 14,
    lastRunAt: '2026-11-12T14:12:00.000Z',
  }),
  rule(ids.rule.r2, 'code-review', 'pr', [], true, { runs30d: 9, lastRunAt: '2026-11-12T14:09:00.000Z' }),
  rule(ids.rule.r3, 'code-e2e', 'any', [], true, { runs30d: 3, lastRunAt: '2026-11-12T10:02:00.000Z' }),
  rule(ids.rule.r4, 'docs-update', 'pr', [], true, { runs30d: 0, lastRunAt: null }),
  rule(ids.rule.r5, 'qa-e2e', 'pr', ['needs-qa'], false, { runs30d: 0, lastRunAt: '2026-11-03T16:00:00.000Z' }),
];
