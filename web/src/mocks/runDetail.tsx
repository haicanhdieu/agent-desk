import { runsById } from './runs';
import type { RunDetailData, RunDetailKey } from './types';

// Prototype boards: RunStarting, RunRunning, RunIdle, RunReconnect, RunSucceeded, RunFailed, RunTimedOut, RunCancelled.
const GH = 'https://github.com/';
const RULE_BUILD = '/code-build on issues labelled user-story';
const RULE_REVIEW = '/code-review on pull requests';

const runningLifecycle = [
  { at: '14:05:10', text: 'Comment received, rule matched' },
  { at: '14:05:11', text: 'Starting' },
  { at: '14:05:19', text: 'Pod running' },
  { at: '14:05:27', text: 'Claude Code started' },
];

const runningChain: RunDetailData['chain'] = [
  { runId: 61, command: '/code-build', ticket: { kind: 'issue', number: 139 }, note: 'This run', status: 'running', here: true },
  { command: '/code-review', context: 'on the PR it opens', note: 'Starts when the agent posts the command', status: 'future' },
];

export const runDetails: Record<RunDetailKey, RunDetailData> = {
  RunStarting: {
    // The Runs board lists run 63 as queued; the RunStarting board shows it once the slot is claimed.
    run: { ...runsById[63], status: 'starting', statusNote: undefined },
    elapsed: '—',
    rule: RULE_BUILD,
    triggerNote: 'comment',
    startedAt: '14:15:13',
    chain: [
      { runId: 63, command: '/code-build', note: 'This run', status: 'starting', here: true },
      { command: '/code-review', context: 'on the PR it opens', note: 'Starts when the agent posts the command', status: 'future' },
    ],
    startup: [
      { label: 'Queued', detail: 'Waited 3m 10s for a free slot', at: '14:12:03', state: 'done' },
      { label: 'Slot claimed, token and secret created', at: '14:15:13', state: 'done' },
      { label: 'Start comment posted on #151', at: '14:15:14', state: 'done' },
      { label: 'Pod scheduled on kind-worker2', at: '14:15:15', state: 'done' },
      { label: 'Cloning harbor-labs/invoicer-api at main', detail: 'In progress, 4 s so far', at: '14:15:19', state: 'active' },
      { label: 'Starting Claude Code in tmux', state: 'pending' },
      { label: 'Terminal attaches', state: 'pending' },
    ],
    connection: { state: 'none', label: 'No terminal yet' },
  },

  RunRunning: {
    run: runsById[61],
    elapsed: '7:40',
    rule: RULE_BUILD,
    triggerNote: 'comment',
    startedAt: '14:05:12',
    chain: runningChain,
    lifecycle: runningLifecycle,
    time: { elapsed: '7:40', limit: '30:00', percent: 26 },
    connection: { state: 'live', label: 'Live, attached as kim-hale' },
    termSize: '132×44',
  },

  RunIdle: {
    run: runsById[62],
    elapsed: '4m 51s',
    rule: RULE_REVIEW,
    triggerNote: 'comment by run 60',
    startedAt: '14:09:07',
    chain: [
      { runId: 60, command: '/code-build', ticket: { kind: 'issue', number: 142 }, note: 'Succeeded in 6m 12s, opened PR #148', status: 'succeeded', href: '/runs/60' },
      { runId: 62, command: '/code-review', ticket: { kind: 'pr', number: 148 }, note: 'This run', status: 'idle', here: true },
    ],
    idle: { since: '14:13:58', endsAt: '14:26', slotNote: 'It holds 1 of 2 slots. Run 63 is queued behind it.' },
    connection: { state: 'live', label: 'Live, attached as kim-hale' },
    termSize: '132×44',
  },

  RunReconnect: {
    // Collapsed side rail on the board ("Chain: 1 of 2"): same run as RunRunning, but the board's top bar shows elapsed 9:02.
    run: runsById[61],
    elapsed: '9:02',
    rule: RULE_BUILD,
    triggerNote: 'comment',
    startedAt: '14:05:12',
    chain: runningChain,
    connection: { state: 'reconnecting', label: 'Reconnecting, attempt 3' },
    termSize: '116×38',
  },

  RunSucceeded: {
    run: runsById[60],
    elapsed: '6m 12s',
    rule: RULE_BUILD,
    triggerNote: 'comment',
    startedAt: '14:02:32',
    endedAt: '14:08:44',
    chain: [
      { runId: 60, command: '/code-build', ticket: { kind: 'issue', number: 142 }, note: 'This run', status: 'succeeded', here: true },
      { runId: 62, command: '/code-review', ticket: { kind: 'pr', number: 148 }, note: 'Needs you', status: 'idle', href: '/runs/62' },
    ],
    pullRequest: {
      ticket: { kind: 'pr', number: 148, title: 'Export invoices as CSV', labels: [], href: GH },
      diffstat: '+214 −12',
    },
    connection: { state: 'ended', label: 'Ended, read-only, 1,208 lines' },
    endNote: {
      title: 'Succeeded in 6m 12s.',
      body: <>Finished by kim-hale at 14:08:44. The next run in this chain started from the agent&apos;s comment.</>,
      actions: [{ label: 'Go to run 62', href: '/runs/62', icon: 'chevron-right' }],
    },
  },

  RunFailed: {
    run: runsById[56],
    elapsed: '1m 10s',
    rule: RULE_REVIEW,
    triggerNote: 'comment by run 55',
    startedAt: '11:29:07',
    endedAt: '11:30:17, exit 1',
    chain: [
      { runId: 55, command: '/code-build', ticket: { kind: 'issue', number: 131 }, note: 'Succeeded, opened PR #133', status: 'succeeded', href: '/runs/55' },
      { runId: 56, command: '/code-review', ticket: { kind: 'pr', number: 133 }, note: 'This run', status: 'failed', here: true },
      { runId: 57, command: '/code-review', ticket: { kind: 'pr', number: 133 }, note: 'Re-issued by kim-hale, succeeded', status: 'succeeded', href: '/runs/57' },
    ],
    connection: { state: 'ended', label: 'Ended, read-only, 17 lines' },
    endNote: {
      title: 'Failed after 1m 10s: the Claude credential was rejected (401)',
      body: <>Claude Code exited with code 1 before doing any work. Replace the credential, then comment the command again on the PR to start a new run.</>,
      actions: [
        { label: 'Replace credential', href: '/desk/agent', icon: 'key' },
        { label: 'Copy /code-review', icon: 'copy' },
        { label: 'Open PR #133', href: GH, icon: 'external' },
      ],
    },
  },

  RunTimedOut: {
    run: runsById[54],
    elapsed: '30:00',
    rule: '/code-e2e on any ticket',
    triggerNote: 'comment',
    startedAt: '10:02:04',
    endedAt: '10:32:04',
    chain: [
      { runId: 54, command: '/code-e2e', ticket: { kind: 'issue', number: 127 }, note: 'This run, no handoff posted', status: 'timed_out', here: true },
    ],
    time: { elapsed: '30:00', limit: '30:00', percent: 100 },
    connection: { state: 'ended', label: 'Ended, read-only, captured on stop' },
    endNote: {
      title: 'Timed out at the 30 minute limit',
      body: (
        <>
          The agent was still running e2e tests. Nothing was pushed: branch <span className="mono">ad/127-flaky-pdf</span> exists only in the
          stopped pod. Raise the limit or split the skill, then comment <span className="mono">/code-e2e</span> again.
        </>
      ),
      actions: [
        { label: 'Change time limit', href: '/desk/agent', icon: 'clock' },
        { label: 'Copy /code-e2e', icon: 'copy' },
      ],
    },
  },

  RunCancelled: {
    run: runsById[52],
    elapsed: '7m 50s',
    rule: RULE_BUILD,
    triggerNote: 'comment',
    startedAt: '13:02:55',
    endedAt: '13:10:45',
    chain: [
      { runId: 52, command: '/code-build', ticket: { kind: 'issue', number: 120 }, note: 'This run', status: 'cancelled', here: true },
    ],
    lifecycle: [
      { at: '13:02:55', text: 'Comment received, rule matched' },
      { at: '13:02:56', text: 'Starting' },
      { at: '13:03:06', text: 'Running' },
      { at: '13:10:41', text: 'Cancel requested by kim-hale' },
      { at: '13:10:45', text: 'Pod removed, run cancelled' },
    ],
    connection: { state: 'ended', label: 'Ended' },
    endNote: {
      title: 'Cancelled by kim-hale at 13:10:41.',
      body: <>The pod was removed 4 s later and a &quot;cancelled&quot; comment was posted on issue #120.</>,
      actions: [{ label: 'Branch ad/120-dark-mode on GitHub', href: GH, icon: 'branch' }],
    },
  },
};
