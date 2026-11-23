import type { Meta, StoryObj } from '@storybook/react-vite';
import {
  autoResumedTerminal,
  orgSwitchFixtures,
  runDetailPrMerged,
  runDetails,
  terminalByRun,
  transcriptFixtures,
  transcriptStateFixtures,
} from '@/mocks';
import { RunDetail } from './RunDetail';
import { RunTerminalArea, type RunTerminalAreaProps } from './RunTerminalArea';
import styles from './Screens.module.css';
import { viewport } from './viewports';

// Artboards come from canvas.json: 1440x900 for all boards except RunReconnect (1280x800).
// The wrapper fixes the size; Storybook 10 ignores the viewport parameter.
const meta = {
  title: 'Screens/Run detail',
  component: RunDetail,
  parameters: { layout: 'fullscreen' },
  // A viewer who holds every run permission: the action buttons show only for the handlers given.
  args: {
    onCancel: () => undefined,
    onFinish: () => undefined,
    onResume: () => undefined,
    onStopOpen: () => undefined,
    onStop: () => undefined,
    onCloseSession: () => undefined,
  },
  // Under the app bar: org / project / Runs / Run N (no bell) and the account menu. Run N comes from the story's run.
  render: (args) => (
    <RunDetail
      {...args}
      org={{ ...orgSwitchFixtures.severalOrgsSettings, orgHref: (o) => `#${o.slug}`, createHref: '#new-org' }}
      run={{ runsHref: '#runs', label: `Run ${args.data.run.id}` }}
    />
  ),
} satisfies Meta<typeof RunDetail>;
export default meta;
type Story = StoryObj<typeof meta>;

const artboard = (width: number, height: number): NonNullable<Story['decorators']> => [
  (S) => (
    <div style={{ width, height }}>
      <S />
    </div>
  ),
];

export const RunStarting: Story = {
  decorators: artboard(1440, 900),
  globals: viewport(1440, 900),
  args: { data: runDetails.RunStarting, lines: terminalByRun[63] },
};
export const RunRunning: Story = {
  decorators: artboard(1440, 900),
  globals: viewport(1440, 900),
  args: { data: runDetails.RunRunning, lines: terminalByRun[61], cancelConfirmOpen: true },
};
export const RunIdle: Story = {
  decorators: artboard(1440, 900),
  globals: viewport(1440, 900),
  args: { data: runDetails.RunIdle, lines: terminalByRun[62] },
};
/** A viewer, or a member on someone else's run: the same run with no action buttons. */
export const RunIdleReadOnly: Story = {
  decorators: artboard(1440, 900),
  globals: viewport(1440, 900),
  args: {
    data: runDetails.RunIdle,
    lines: terminalByRun[62],
    onCancel: undefined,
    onFinish: undefined,
    onResume: undefined,
    onStopOpen: undefined,
    onStop: undefined,
    onCloseSession: undefined,
  },
};
export const RunReconnect: Story = {
  decorators: artboard(1280, 800),
  globals: viewport(1280, 800),
  args: { data: runDetails.RunReconnect, lines: terminalByRun[61], panelCollapsed: true, height: 800 },
};
export const RunSucceeded: Story = {
  decorators: artboard(1440, 900),
  globals: viewport(1440, 900),
  args: { data: runDetails.RunSucceeded, lines: terminalByRun[60] },
};
/** Run 60 with its Prompt section open (prototype board RunPrompt). */
export const RunPrompt: Story = {
  decorators: artboard(1440, 900),
  globals: viewport(1440, 900),
  args: { data: { ...runDetails.RunSucceeded, promptOpen: true }, lines: terminalByRun[60] },
};
export const RunFailed: Story = {
  decorators: artboard(1440, 900),
  globals: viewport(1440, 900),
  args: { data: runDetails.RunFailed, lines: terminalByRun[56] },
};
/** Failed in setup: the agent never started (prototype board RunSetupFailed). */
export const RunSetupFailed: Story = {
  decorators: artboard(1440, 900),
  globals: viewport(1440, 900),
  args: { data: runDetails.RunSetupFailed, lines: terminalByRun[58] },
};
export const RunTimedOut: Story = {
  decorators: artboard(1440, 900),
  globals: viewport(1440, 900),
  args: { data: runDetails.RunTimedOut, lines: terminalByRun[54] },
};
export const RunCancelled: Story = {
  decorators: artboard(1440, 900),
  globals: viewport(1440, 900),
  args: { data: runDetails.RunCancelled },
};

/** Paused by the idle timer: how long it can be resumed, the agent note, Resume and Finish. */
export const RunPaused: Story = {
  decorators: artboard(1440, 900),
  globals: viewport(1440, 900),
  args: { data: runDetails.RunPaused, lines: terminalByRun[62], onResume: () => {} },
};
/** A resume in flight: both buttons wait. */
export const RunPausedResuming: Story = {
  decorators: artboard(1440, 900),
  globals: viewport(1440, 900),
  args: { data: runDetails.RunPaused, lines: terminalByRun[62], resuming: true },
};
/** The resume fell back: the error sits above the buttons and the run can be resumed again. */
export const RunResumeFailed: Story = {
  decorators: artboard(1440, 900),
  globals: viewport(1440, 900),
  args: {
    data: {
      ...runDetails.RunPaused,
      session: {
        ...runDetails.RunPaused.session,
        state: 'paused',
        resumeFailure: 'Resume failed: no saved session was found',
      },
    },
    lines: terminalByRun[62],
  },
};
/** Succeeded with its session kept: Reopen session until the kept time passes. */
export const RunSucceededKept: Story = {
  decorators: artboard(1440, 900),
  globals: viewport(1440, 900),
  args: {
    data: {
      ...runDetails.RunSucceeded,
      agentNote: 'Opened PR #148 with the CSV export and tests.',
      session: { state: 'kept', detail: 'Session kept until 13 Nov, 14:20' },
    },
    lines: terminalByRun[60],
    onResume: () => {},
  },
};
/** A reopened session of a succeeded run: the pill says so and Close session is the only action. */
export const RunReopened: Story = {
  decorators: artboard(1440, 900),
  globals: viewport(1440, 900),
  args: {
    data: { ...runDetails.RunDone, reopened: true },
    lines: terminalByRun[62],
    onCloseSession: () => {},
  },
};
/** The disk is gone: Reopen session is disabled with a tooltip and the tab reads Transcript (read-only). */
export const RunSucceededReopenUnavailable: Story = {
  decorators: artboard(1440, 900),
  globals: viewport(1440, 900),
  args: { data: runDetails.RunSucceeded, lines: terminalByRun[60] },
};
/** Nobody resumed it in time: the saved session was deleted, no actions. */
export const RunExpired: Story = {
  decorators: artboard(1440, 900),
  globals: viewport(1440, 900),
  args: { data: runDetails.RunExpired },
};

/** Stopped by you: the Stopped notice with Resume and Finish, and the saved Transcript, read-only. */
export const RunStopped: Story = {
  decorators: artboard(1440, 900),
  globals: viewport(1440, 900),
  args: {
    data: runDetails.RunStopped,
    transcript: { state: 'ready', items: transcriptFixtures.default, hasEarlier: true },
    onResume: () => {},
  },
};
/** A stopped run after Finish: succeeded, the session is gone, the Transcript stays. */
export const RunSucceededFinished: Story = {
  decorators: artboard(1440, 900),
  globals: viewport(1440, 900),
  args: {
    data: runDetails.RunSucceededFinished,
    transcript: {
      state: 'ready',
      items: transcriptFixtures.default.filter((i) => i.kind !== 'notice' && !i.truncated),
    },
  },
};

const readOnlyTranscript = { state: 'ready', items: transcriptFixtures.default, hasEarlier: true } as const;
const pausedAfterCrash = (key: keyof typeof runDetails): Story => ({
  decorators: artboard(1440, 900),
  globals: viewport(1440, 900),
  args: { data: runDetails[key], transcript: readOnlyTranscript, onResume: () => {}, onFinish: () => {} },
});

/** Paused after the pod was killed: automatic resume is off or has not tried yet; no gave-up line. */
export const RunStoppedPodLost: Story = pausedAfterCrash('RunStoppedPodLost');
/** Automatic resume ran out of tries: the third line says so. */
export const RunStoppedPodLostGaveUp: Story = pausedAfterCrash('RunStoppedPodLostGaveUp');
/** Gave up after a single try ("1 time"). */
export const RunStoppedPodLostGaveUpOnce: Story = pausedAfterCrash('RunStoppedPodLostGaveUpOnce');
/** The agent crashed and the tries ran out. */
export const RunStoppedCrashedGaveUp: Story = pausedAfterCrash('RunStoppedCrashedGaveUp');
/** An automatic try could not start the pod: the error bar, and the next try is waiting. */
export const RunStoppedAutoResumeWaiting: Story = pausedAfterCrash('RunStoppedAutoResumeWaiting');
/** The last automatic try could not start the pod and the tries ran out. */
export const RunStoppedAutoResumeFailedGaveUp: Story = pausedAfterCrash('RunStoppedAutoResumeFailedGaveUp');
/** Running again after an automatic resume: the lifecycle lines and the note in the terminal. */
export const RunRunningAutoResume: Story = {
  decorators: artboard(1440, 900),
  globals: viewport(1440, 900),
  args: { data: runDetails.RunRunningAutoResume, lines: autoResumedTerminal },
};

const stateCells: { caption: string; props: RunTerminalAreaProps }[] = [
  {
    caption: "Paused by the idle timer: today's notice, the Transcript below.",
    props: {
      data: runDetails.RunPaused,
      transcript: { state: 'ready', items: transcriptStateFixtures.pausedIdleTimer },
    },
  },
  {
    caption: "Failed: a short transcript starts at the run's prompt.",
    props: {
      data: runDetails.RunFailed,
      transcript: { state: 'ready', items: transcriptStateFixtures.failed },
    },
  },
  {
    caption: "Timed out: today's notice, the Transcript below.",
    props: {
      data: runDetails.RunTimedOut,
      transcript: { state: 'ready', items: transcriptStateFixtures.timedOut },
    },
  },
  {
    caption: 'Cancelled: the Transcript replaces \u201cNo scrollback was saved\u201d.',
    props: {
      data: runDetails.RunCancelled,
      transcript: { state: 'ready', items: transcriptStateFixtures.cancelled },
    },
  },
  {
    caption: 'Expired: the Transcript stays after the session is deleted.',
    props: {
      data: { ...runDetails.RunExpired, connection: { state: 'ended', label: 'Ended, read-only' } },
      transcript: { state: 'ready', items: transcriptStateFixtures.expired },
    },
  },
  {
    caption: 'Error: Retry loads it again; nothing starts a pod.',
    props: {
      data: runDetails.RunPaused,
      transcript: { state: 'error', items: [], requestId: '01JDK8Q3V2' },
    },
  },
  {
    caption: 'No entries (older run or image): saved terminal text, as today.',
    props: {
      data: { ...runDetails.RunPaused, connection: { state: 'ended', label: 'Paused, read-only, 412 lines' } },
      lines: terminalByRun[62],
    },
  },
  {
    caption: 'No entries and no saved text: the new empty state.',
    props: {
      data: { ...runDetails.RunFailed, connection: { state: 'ended', label: 'Ended' } },
      transcript: { state: 'ready', items: [] },
    },
  },
];

/** The Transcript in the other stopped and ended states, side by side. */
export const RunTranscriptStates: Story = {
  decorators: [
    (S) => (
      <div style={{ width: 1440, height: 740, display: 'flex', flexDirection: 'column' }}>
        <S />
      </div>
    ),
  ],
  globals: viewport(1440, 740),
  args: { data: runDetails.RunPaused },
  render: () => (
    <div className={styles.stateGrid}>
      {stateCells.map((c) => (
        <div key={c.caption} className={styles.stateCell}>
          <RunTerminalArea {...c.props} label={c.caption} />
          <div className={styles.stateCaption}>{c.caption}</div>
        </div>
      ))}
    </div>
  ),
};

/** Stop session pressed on a running run: the confirm names the paused keep time. */
export const RunRunningStop: Story = {
  decorators: artboard(1440, 900),
  globals: viewport(1440, 900),
  args: {
    data: runDetails.RunRunningStop,
    lines: terminalByRun[61],
    stopConfirmOpen: true,
    onStopClose: () => {},
    onStop: () => {},
  },
};
/** The session is ending after Stop session: Stop session is disabled and the Transcript is loading. */
export const RunIdleEnding: Story = {
  decorators: artboard(1440, 900),
  globals: viewport(1440, 900),
  args: { data: runDetails.RunIdleEnding, transcript: { state: 'loading', items: [] } },
};
/** Finish is in flight on an idle run: Stop session waits with it. */
export const RunIdleActionPending: Story = {
  decorators: artboard(1440, 900),
  globals: viewport(1440, 900),
  args: { data: runDetails.RunIdle, lines: terminalByRun[62], pendingNote: 'Finishing…' },
};

/** RunIdle on a merged PR: top bar, Ticket card, chain step and Pull request section are purple. */
export const RunPrMerged: Story = {
  decorators: artboard(1440, 900),
  globals: viewport(1440, 900),
  args: { data: runDetailPrMerged, lines: terminalByRun[62] },
};
export const RunPrMergedCollapsed: Story = {
  decorators: artboard(1440, 900),
  globals: viewport(1440, 900),
  args: { data: runDetailPrMerged, lines: terminalByRun[62], panelCollapsed: true },
};
