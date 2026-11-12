import type { Actor, Project } from './types';
import { connections } from './connection';

// Prototype boards: Projects, Runs (top bar user). invoicer-web polls; billing-jobs shows a polling error.
export const user: Actor = { login: 'kim-hale', initials: 'KH' };
export const bot: Actor = { login: 'agent-desk[bot]', bot: true };

export const projects: Project[] = [
  {
    id: 'invoicer-api', org: 'harbor-labs', name: 'invoicer-api', repo: 'harbor-labs/invoicer-api',
    connection: connections.webhookOk, needsYou: 1, running: 1, queued: 1, lastRun: 'Run 63, 2 min ago',
  },
  {
    id: 'invoicer-web', org: 'harbor-labs', name: 'invoicer-web', repo: 'harbor-labs/invoicer-web',
    connection: connections.pollingOk, needsYou: 0, running: 0, queued: 0, lastRun: 'Run 19, yesterday',
  },
  {
    id: 'docs-site', org: 'kim-hale', name: 'docs-site', repo: 'kim-hale/docs-site',
    connection: connections.webhookSilent, needsYou: 0, running: 0, queued: 0, lastRun: 'Run 4, 12 Oct',
  },
  {
    id: 'billing-jobs', org: 'harbor-labs', name: 'billing-jobs', repo: 'harbor-labs/billing-jobs',
    connection: connections.pollingRateLimited, needsYou: 0, running: 0, queued: 0, lastRun: 'Run 31, 3 hours ago',
  },
];


/** The Desk boards' top bar and navigation (invoicer-api), in the DeskFrameData shape. */
export const deskFrame = {
  user,
  project: { org: 'harbor-labs', name: 'invoicer-api', repo: 'harbor-labs/invoicer-api', needsYou: 1 },
  connection: connections.webhookOk,
};
