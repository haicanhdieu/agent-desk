import type { Rule } from './types';

// Prototype board: DeskRules.
export const rules: Rule[] = [
  { id: 'r1', command: 'code-build', target: 'issue', labels: ['user-story'], skill: 'code-build', agent: 'Claude', enabled: true, stats: '14 runs this week, last 14:15' },
  { id: 'r2', command: 'code-review', target: 'pr', labels: [], skill: 'code-review', agent: 'Claude', enabled: true, stats: '9 runs this week, last 14:09' },
  { id: 'r3', command: 'code-e2e', target: 'any', labels: [], skill: 'code-e2e', agent: 'Claude', enabled: true, stats: '3 runs this week, last 10:02' },
  {
    id: 'r4', command: 'docs-update', target: 'pr', labels: [], skill: 'docs-update', agent: 'Claude', enabled: true, stats: 'Never ran',
    warning: 'Skill docs-update is not in .claude/skills/ on main. Comments with /docs-update are ignored until you add it or pick another skill.',
  },
  { id: 'r5', command: 'qa-e2e', target: 'pr', labels: ['needs-qa'], skill: 'qa-e2e', agent: 'Claude', enabled: false, stats: 'Turned off 3 Nov' },
];
