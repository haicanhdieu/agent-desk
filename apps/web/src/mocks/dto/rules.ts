import type { PromptPreviewDto, RuleDto } from '@agentdesk/contracts';
import { TRIAGE_PROMPT } from '../rules';
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
  model: null,
  kind: 'skill',
  skillName: command,
  prompt: null,
  enabled,
  stats,
});

/** The custom prompt rule of mocks/rules.ts (r6): no skill, the prompt as written. */
const triage: RuleDto = {
  ...rule(ids.rule.r6, 'triage', 'issue', [], true, { runs30d: 5, lastRunAt: '2026-11-12T13:40:00.000Z' }),
  kind: 'prompt',
  skillName: null,
  prompt: TRIAGE_PROMPT,
};

export const ruleFixtures: RuleDto[] = [
  rule(ids.rule.r1, 'code-build', 'issue', ['user-story'], true, {
    runs30d: 14,
    lastRunAt: '2026-11-12T14:12:00.000Z',
  }),
  rule(ids.rule.r2, 'code-review', 'pr', [], true, { runs30d: 9, lastRunAt: '2026-11-12T14:09:00.000Z' }),
  rule(ids.rule.r3, 'code-e2e', 'any', [], true, { runs30d: 3, lastRunAt: '2026-11-12T10:02:00.000Z' }),
  rule(ids.rule.r4, 'docs-update', 'pr', [], true, { runs30d: 0, lastRunAt: null }),
  rule(ids.rule.r5, 'qa-e2e', 'pr', ['needs-qa'], false, { runs30d: 0, lastRunAt: '2026-11-03T16:00:00.000Z' }),
  triage,
];

/** What `rules.promptPreview` answers for a project: the lines Agent Desk appends, with the repo filled in. */
export const promptPreviewFixture = (repoPath: string): PromptPreviewDto => ({
  systemLines: [
    `Ticket: <issue or PR #number> in ${repoPath}. Read it and all its comments with the gh CLI before you start.`,
    'Arguments from the user: <text after /command>',
    'When done, report on the ticket.',
    'RULE: RAM is capped (/sys/fs/cgroup/memory.max); exceeding it kills the pod. You MUST check memory before heavy tasks and order parallel work to fit, and MUST kill unused processes and shells and delete temp files.',
    'Before you end a turn, run `agentdesk-status done "<one-line summary>"` if the task is complete, or `agentdesk-status needs_input "<your question>"` if you need an answer from the human.',
  ],
});
