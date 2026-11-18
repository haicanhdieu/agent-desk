import type { Meta, StoryObj } from '@storybook/react-vite';
import { runDetails, terminalByRun } from '@/mocks';
import { RunTerminalArea } from './RunTerminalArea';

const meta = {
  title: 'Screens/RunTerminalArea',
  component: RunTerminalArea,
  parameters: { layout: 'fullscreen' },
  decorators: [
    (S) => (
      <div style={{ height: 520, display: 'flex', flexDirection: 'column' }}>
        <S />
      </div>
    ),
  ],
} satisfies Meta<typeof RunTerminalArea>;
export default meta;
type Story = StoryObj<typeof meta>;

/** The agent declared the task done: Finish is offered, the terminal stays open. */
export const Done: Story = {
  args: {
    data: { ...runDetails.RunDone, agentNote: 'Opened PR #148 with the CSV export and tests.' },
    lines: terminalByRun[62],
  },
};

/** The agent asked a question: its note shows above the usual body. */
export const NeedsYouWithNote: Story = {
  args: {
    data: { ...runDetails.RunIdle, agentNote: 'Should the export include voided invoices?' },
    lines: terminalByRun[62],
  },
};

const { RunPaused, RunExpired, RunIdle, RunStarting, RunSucceeded } = runDetails;
const pausedSession = (headline: string, detail: string) => ({ state: 'paused' as const, headline, detail });

/** The idle timer (or Finish) is ending the session: the terminal is closed and its last scrollback greyed, no socket is open, the page updates by itself. */
export const Pausing: Story = {
  args: {
    data: { ...RunIdle, pausing: true, connection: { state: 'none', label: 'Ending…' } },
    // The last scrollback, greyed.
    lines: terminalByRun[62],
  },
};

/** Nobody used the page for hours: the browser closed the terminal, so the run can pause. Reconnect attaches again. */
export const InactiveClosed: Story = {
  args: {
    data: { ...RunIdle, connection: { state: 'none', label: 'Closed for inactivity' } },
    lines: terminalByRun[62],
    inactiveBody:
      'Nobody used this page for 4 hours, so the terminal was closed and the run can pause when it is idle. The agent keeps working; tmux holds the session. Reconnect to attach to the terminal again.',
    onReconnect: () => {},
    onFinish: () => {},
  },
};

/** Paused by the idle timer: the usual headline and reason. */
export const PausedIdleTimeout: Story = {
  args: { data: RunPaused, lines: terminalByRun[62], onResume: () => {}, onFinish: () => {} },
};

/** Paused because its pod stopped and the cluster gave no exit code (evicted, node lost, cluster unreachable). */
export const PausedPodLost: Story = {
  args: {
    data: {
      ...RunPaused,
      session: pausedSession(
        'Paused: the pod stopped unexpectedly',
        'Paused 12 min ago, the pod stopped unexpectedly (out of memory / evicted). Can be resumed for 5 days.',
      ),
    },
    lines: terminalByRun[62],
    onResume: () => {},
    onFinish: () => {},
  },
};

/** Paused because its pod was killed with exit code 137: the memory limit was hit. */
export const PausedPodOutOfMemory: Story = {
  args: {
    data: {
      ...RunPaused,
      session: pausedSession(
        'Paused: the pod was killed, most likely out of memory (exit code 137)',
        'Paused 12 min ago, the pod stopped unexpectedly (out of memory / evicted). Can be resumed for 5 days.',
      ),
    },
    lines: terminalByRun[62],
    onResume: () => {},
    onFinish: () => {},
  },
};

/** Paused because the agent crashed: the exit code is information from the runner's end line. */
export const PausedAgentCrashed: Story = {
  args: {
    data: {
      ...RunPaused,
      session: pausedSession(
        'Paused: agent crashed (exit code 137)',
        'Paused 12 min ago, the agent crashed. Can be resumed for 5 days.',
      ),
    },
    lines: terminalByRun[62],
    onResume: () => {},
    onFinish: () => {},
  },
};

/** A resumed run before its next turn: what was kept and what was lost, above the usual notice. */
export const Resumed: Story = {
  args: {
    data: {
      ...RunIdle,
      agentNote: 'Should the export include voided invoices?',
      resumed:
        'Resumed. The agent asked: Should the export include voided invoices?. Background tasks and sub-agents that were running when it paused were stopped.',
    },
    lines: terminalByRun[62],
  },
};

/** Nobody resumed it within the keep time. */
export const Expired: Story = { args: { data: RunExpired } };

/** Loading: a Resume is queued, waiting for a slot and a pod. */
export const Resuming: Story = {
  args: { data: { ...RunStarting, resuming: true } },
};

/** Error: a Resume queued behind the ending found nothing kept, so the run stayed succeeded. */
export const ResumeFailedNothingKept: Story = {
  args: {
    data: {
      ...RunSucceeded,
      session: { state: 'none', resumeFailure: 'Resume failed: nothing was kept to resume from' },
    },
    lines: terminalByRun[60],
  },
};
