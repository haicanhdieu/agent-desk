import { PR_STATES } from '@/ds/tokens';
import type { IgnoredCommand } from './types';

// Prototype board: RunsProblems ("Ignored commands").
const href = 'https://github.com/';

export const ignored: IgnoredCommand[] = [
  {
    at: '14:16',
    ticket: { kind: 'issue', number: 160 },
    command: '/code-build',
    author: 'octo-visitor',
    reason: 'Author has no write access',
    detail: 'octo-visitor is not a collaborator on the repo.',
    href,
  },
  {
    at: '13:58',
    ticket: { kind: 'pr', number: 133 },
    command: '/code-review',
    author: 'agent-desk[bot]',
    reason: 'Run limit reached',
    detail: 'PR #133 already has 10 runs. Raise the limit or start a new ticket.',
    href,
  },
  {
    at: '13:41',
    ticket: { kind: 'pr', number: 148 },
    command: '/code-review',
    author: 'kim-hale',
    reason: 'Already running',
    detail: 'Run 62 (code-review) is still active on this ticket.',
    href,
  },
  {
    at: '12:07',
    ticket: { kind: 'issue', number: 158 },
    command: '/code-build',
    author: 'kim-hale',
    reason: 'Label missing',
    detail: 'Rule needs label user-story. The issue has: bug.',
    href,
  },
  {
    at: '11:15',
    ticket: { kind: 'issue', number: 131 },
    command: '/deploy',
    author: 'kim-hale',
    reason: 'No rule for command',
    detail: 'No enabled rule uses /deploy.',
    href,
  },
];

/** Ignored rows on PRs: one per live state, plus PR #174 whose state is unknown. */
export const ignoredPrStates: IgnoredCommand[] = [
  ...PR_STATES.map((prState, i): IgnoredCommand => ({
    at: `10:0${i}`,
    ticket: { kind: 'pr', number: 170 + i, prState },
    command: '/code-review',
    author: 'kim-hale',
    reason: 'Already running',
    detail: `Run 62 (code-review) is still active on PR #${170 + i}.`,
    href,
  })),
  {
    at: '10:04',
    ticket: { kind: 'pr', number: 174 },
    command: '/code-review',
    author: 'kim-hale',
    reason: 'Already running',
    detail: 'Run 62 (code-review) is still active on PR #174.',
    href,
  },
];
