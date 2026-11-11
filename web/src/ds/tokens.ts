export type RunStatus =
  | 'queued' | 'starting' | 'running' | 'idle' | 'succeeded' | 'failed' | 'cancelled' | 'timed_out';

export const RUN_STATUSES: readonly RunStatus[] = [
  'queued', 'starting', 'running', 'idle', 'succeeded', 'failed', 'cancelled', 'timed_out',
];

export const statusTokens: Record<RunStatus, { label: string; colorVar: string }> = {
  queued: { label: 'Queued', colorVar: '--off' },
  starting: { label: 'Starting', colorVar: '--run' },
  running: { label: 'Running', colorVar: '--run' },
  idle: { label: 'Needs you', colorVar: '--idle' },
  succeeded: { label: 'Succeeded', colorVar: '--ok' },
  failed: { label: 'Failed', colorVar: '--fail' },
  cancelled: { label: 'Cancelled', colorVar: '--off' },
  timed_out: { label: 'Timed out', colorVar: '--late' },
};
