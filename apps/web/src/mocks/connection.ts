import type { ConnectionStatus, ConnectionWarning, PollInterval, TriggerMode } from './types';

// Trigger mode (webhook or polling) and connection status. Every user-facing string for this
// lives here so it is easy to keep in step with design/prototype (Setup1, Setup1Polling,
// Setup1PollingOk, SetupReady, Projects, RunsProblems, DeskAgent) and the PRD.

export const pollIntervals: PollInterval[] = ['5 min', '10 min', '15 min', '30 min'];
/** The minimum is also the default. */
export const DEFAULT_POLL_INTERVAL: PollInterval = '5 min';

/** "5 min" -> "5 minutes", for sentences. */
const minutes = (interval: PollInterval) => interval.replace(' min', ' minutes');

export const connectionCopy = {
  // Setup step 1: the mode choice.
  modeLabel: 'How Agent Desk hears about new comments',
  modes: {
    webhook: { title: 'Webhook', description: 'Near-instant. GitHub must reach Agent Desk at a public URL.' },
    polling: { title: 'Polling', description: 'Works without a public URL. Runs start up to one interval later.' },
  } satisfies Record<TriggerMode, { title: string; description: string }>,
  intervalLabel: 'Check every',
  modeLaterHelp: 'You can change the mode later in project settings.',
  continueAfterCheck: 'Available after the first check',

  // Setup step 1, webhook: ping banner and the aside help.
  pingReceived: (at: string) => `Webhook ping received at ${at}`,
  pingReceivedBody: 'GitHub can reach Agent Desk. Comments on this repository will arrive within seconds.',
  pingHelpTitle: 'If the ping does not arrive',
  pingHelpBody: 'On a local cluster GitHub cannot reach you. Choose Polling instead, or start the webhook relay and press',
  pingHelpCheckAgain: 'Check again',
  pingHelpTail: '. Until then this step shows "Waiting for webhook ping".',

  // Setup step 1, polling: first check, success, failure and the aside help.
  pollingChecking: 'Checking issue comments for the first time',
  pollingCheckingBody: 'No webhook or relay needed. This takes a few seconds.',
  pollingChecked: (interval: PollInterval, ago: string) => `Polling every ${interval} · last checked ${ago}`,
  pollingCheckedBody: (interval: PollInterval) =>
    `Agent Desk can read comments on this repository. A new command starts a run within ${minutes(interval)}.`,
  pollingCostTitle: 'Polling and the GitHub rate limit',
  pollingCostBody: 'Each check is one request per repository, so 12 an hour at 5 min. GitHub gives the app 5,000 an hour, and a check with no new comments does not count.',

  // Project connection status (Projects list, project switcher, Desk side nav).
  connected: 'Connected',
  webhookSilent: (age: string) => `No webhooks for ${age}`,
  polling: (interval: PollInterval) => `Polling every ${interval}`,
  pollingFailed: (reason: string) => `Polling failed: ${reason}`,
  pollingFailedBody: 'Agent Desk keeps trying on its own. Comments posted meanwhile start runs once a check succeeds.',
  reasons: {
    tokenRevoked: 'token revoked',
    rateLimited: (minutes: number) => `rate limited, retry in ${minutes} min`,
  },
  menuWarning: { webhook: 'webhooks', polling: 'polling' } satisfies Record<TriggerMode, string>,

  // Project settings (Desk, Agent & settings).
  triggerModeTerm: 'Trigger mode',
  triggerModeHelp: 'Webhook is near-instant. Polling works without a public URL; runs start up to one interval later.',
  lastEventTerm: 'Last event',
  lastCheckedTerm: 'Last checked',

  // Actions.
  switchToPolling: 'Switch to polling',
  retryNow: 'Retry now',
  checkNow: 'Check now',
  checkAgain: 'Check again',
  connectionDetails: 'Connection details',

  // Setup ready: what was heard last, and the summary row.
  listeningTitle: 'Listening for your first command',
  listeningBody: 'This page opens the run as soon as it starts.',
  lastEvent: (at: string) => `Last event: ${at} (webhook)`,
  lastChecked: (at: string) => `Last checked: ${at} (polling)`,
  triggerTerm: 'Trigger',
  triggerSummary: (mode: TriggerMode, interval: PollInterval = DEFAULT_POLL_INTERVAL) =>
    (mode === 'webhook' ? 'Webhook' : `Polling every ${interval}`),
} as const;

/** Ready-made statuses for the mocks and stories. */
export const connections = {
  webhookOk: { mode: 'webhook', tone: 'ok', text: connectionCopy.connected },
  webhookSilent: { mode: 'webhook', tone: 'warn', text: connectionCopy.webhookSilent('2 days') },
  pollingOk: { mode: 'polling', tone: 'ok', text: connectionCopy.polling(DEFAULT_POLL_INTERVAL) },
  pollingRevoked: { mode: 'polling', tone: 'err', text: connectionCopy.pollingFailed(connectionCopy.reasons.tokenRevoked) },
  pollingRateLimited: { mode: 'polling', tone: 'err', text: connectionCopy.pollingFailed(connectionCopy.reasons.rateLimited(5)) },
} satisfies Record<string, ConnectionStatus>;

/** Short warning in the project switcher, or undefined when the connection is fine. */
export function menuWarning(c: ConnectionStatus): string | undefined {
  return c.tone === 'ok' ? undefined : connectionCopy.menuWarning[c.mode];
}

/** Banners above the runs list when commands may be missed. */
export const connectionWarnings = {
  webhookSilent: {
    tone: 'err', icon: 'warning', title: 'No webhooks from GitHub since 11:42',
    body: 'Comments posted since then have not started runs. The last delivery attempt failed with HTTP 502 at the relay. Start the webhook relay and redeliver missed events from the app settings in GitHub, or switch this project to polling, which needs no public URL.',
    actions: [
      { label: connectionCopy.switchToPolling, href: '/desk/agent', variant: 'primary' },
      { label: connectionCopy.checkAgain, icon: 'refresh' },
      { label: connectionCopy.connectionDetails, href: '/desk/agent', variant: 'ghost' },
    ],
  },
  pollingFailed: {
    tone: 'err', icon: 'warning', title: connectionCopy.pollingFailed(connectionCopy.reasons.tokenRevoked),
    body: `The last good check was at 11:42. ${connectionCopy.pollingFailedBody} Reinstall the GitHub App or give it access to this repository again.`,
    actions: [
      { label: connectionCopy.retryNow, icon: 'refresh' },
      { label: connectionCopy.connectionDetails, href: '/desk/agent', variant: 'ghost' },
    ],
  },
} satisfies Record<string, ConnectionWarning>;
