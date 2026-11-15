import type { Rule } from './types';

/** A custom prompt rule (prototype boards DeskRules, DeskRulesPrompt). */
export const TRIAGE_PROMPT = [
  'Triage this issue: add one of the labels bug, feature or question, and a size label (S, M or L).',
  'If a bug report has no steps to reproduce, ask for them in a comment.',
  'Do not change any code or open a pull request.',
].join('\n');

/**
 * What Agent Desk appends to a custom prompt, as the prompt preview would serve it for harbor-labs/invoicer-api
 * (placeholders in angle brackets). Prototype boards DeskRulesPrompt, DeskRulesPromptNew.
 */
export const promptSystemLines = [
  'Ticket: <issue or PR #number> in harbor-labs/invoicer-api. Read it and all its comments with the gh CLI before you start.',
  'Arguments from the user: <text after /command>',
  'When done, report on the ticket.',
  'Before you end a turn, run `agentdesk-status done "<one-line summary>"` if the task is complete, or `agentdesk-status needs_input "<your question>"` if you need an answer from the human.',
];

// Prototype board: DeskRules.
export const rules: Rule[] = [
  {
    id: 'r1',
    command: 'code-build',
    target: 'issue',
    labels: ['user-story'],
    skill: 'code-build',
    agent: 'Claude',
    enabled: true,
    stats: '14 runs this week, last 14:15',
  },
  {
    id: 'r2',
    command: 'code-review',
    target: 'pr',
    labels: [],
    skill: 'code-review',
    agent: 'Claude',
    enabled: true,
    stats: '9 runs this week, last 14:09',
  },
  {
    id: 'r3',
    command: 'code-e2e',
    target: 'any',
    labels: [],
    skill: 'code-e2e',
    agent: 'Claude',
    enabled: true,
    stats: '3 runs this week, last 10:02',
  },
  {
    id: 'r6',
    command: 'triage',
    target: 'issue',
    labels: [],
    skill: '',
    kind: 'prompt',
    prompt: TRIAGE_PROMPT,
    agent: 'Claude',
    enabled: true,
    stats: '5 runs this week, last 13:40',
  },
  {
    id: 'r4',
    command: 'docs-update',
    target: 'pr',
    labels: [],
    skill: 'docs-update',
    agent: 'Claude',
    enabled: true,
    stats: 'Never ran',
    warning:
      'Skill docs-update is not in .claude/skills/ on main. Comments with /docs-update are ignored until you add it or pick another skill.',
  },
  {
    id: 'r5',
    command: 'qa-e2e',
    target: 'pr',
    labels: ['needs-qa'],
    skill: 'qa-e2e',
    agent: 'Claude',
    enabled: false,
    stats: 'Turned off 3 Nov',
  },
];
