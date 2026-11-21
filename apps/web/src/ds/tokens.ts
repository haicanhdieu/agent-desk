export type RunStatus =
  | 'queued'
  | 'starting'
  | 'running'
  | 'idle'
  | 'done'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'timed_out'
  | 'paused'
  | 'expired';

export const RUN_STATUSES: readonly RunStatus[] = [
  'queued',
  'starting',
  'running',
  'idle',
  'done',
  'succeeded',
  'failed',
  'cancelled',
  'timed_out',
  'paused',
  'expired',
];

export const statusTokens: Record<RunStatus, { label: string; colorVar: string }> = {
  queued: { label: 'Queued', colorVar: '--off' },
  starting: { label: 'Starting', colorVar: '--run' },
  running: { label: 'Running', colorVar: '--run' },
  idle: { label: 'Needs you', colorVar: '--idle' },
  done: { label: 'Done', colorVar: '--ok' },
  succeeded: { label: 'Succeeded', colorVar: '--ok' },
  failed: { label: 'Failed', colorVar: '--fail' },
  cancelled: { label: 'Cancelled', colorVar: '--off' },
  timed_out: { label: 'Timed out', colorVar: '--late' },
  paused: { label: 'Paused', colorVar: '--idle' },
  expired: { label: 'Expired', colorVar: '--off' },
};

/** Live state of a pull request, as the ticket source reports it. */
export type PrState = 'open' | 'draft' | 'merged' | 'closed';

export const PR_STATES: readonly PrState[] = ['open', 'draft', 'merged', 'closed'];

export const prStateTokens: Record<PrState, { label: string; colorVar: string }> = {
  open: { label: 'Open', colorVar: '--pr-open' },
  draft: { label: 'Draft', colorVar: '--pr-draft' },
  merged: { label: 'Merged', colorVar: '--pr-merged' },
  closed: { label: 'Closed', colorVar: '--pr-closed' },
};

/** Shared tone vocabulary for banners and inline status text. */
export type StatusTone = 'ok' | 'warn' | 'err' | 'late' | 'off' | 'idle';
