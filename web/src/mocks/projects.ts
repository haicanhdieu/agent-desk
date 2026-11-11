import type { Actor, Project } from './types';

// Prototype boards: Projects, Runs (top bar user).
export const user: Actor = { login: 'kim-hale', initials: 'KH' };
export const bot: Actor = { login: 'agent-desk[bot]', bot: true };

export const projects: Project[] = [
  {
    id: 'invoicer-api', org: 'harbor-labs', name: 'invoicer-api', repo: 'harbor-labs/invoicer-api',
    connection: { tone: 'ok', text: 'Connected' }, needsYou: 1, running: 1, queued: 1, lastRun: 'Run 63, 2 min ago',
  },
  {
    id: 'invoicer-web', org: 'harbor-labs', name: 'invoicer-web', repo: 'harbor-labs/invoicer-web',
    connection: { tone: 'ok', text: 'Connected' }, needsYou: 0, running: 0, queued: 0, lastRun: 'Run 19, yesterday',
  },
  {
    id: 'docs-site', org: 'kim-hale', name: 'docs-site', repo: 'kim-hale/docs-site',
    connection: { tone: 'warn', text: 'No webhooks for 2 days' }, needsYou: 0, running: 0, queued: 0, lastRun: 'Run 4, 12 Oct',
  },
];
