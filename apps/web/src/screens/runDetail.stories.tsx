import type { Meta, StoryObj } from '@storybook/react-vite';
import { userEvent, within } from 'storybook/test';
import {
  autoResumedTerminal,
  runDetailPrMerged,
  runDetails,
  runUsageDetails,
  terminalByRun,
  transcriptFixtures,
  transcriptStateFixtures,
} from '@/mocks';
import { ProjectShellFrame, type ProjectShellFrameProps } from './projectShellFrame';
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
  // Inside the shell: the bar (org / project / Runs / Run N), the project menu and the page header. Run N comes from the story's run.
  render: (args) => (
    <ProjectShellFrame page="runs" fill crumbs={runCrumbs(args.data.run.id)}>
      <RunDetail {...args} />
    </ProjectShellFrame>
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
  args: { data: runDetails.RunReconnect, lines: terminalByRun[61], panelCollapsed: true },
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

/** Run 60 with the Usage section open: one model. */
export const RunSucceededUsage: Story = {
  decorators: artboard(1440, 900),
  globals: viewport(1440, 900),
  args: { data: runUsageDetails.RunSucceededUsage, lines: terminalByRun[60] },
};
/** The Usage section collapsed to its header. */
export const RunSucceededUsageCollapsed: Story = {
  decorators: artboard(1440, 900),
  globals: viewport(1440, 900),
  args: { data: runUsageDetails.RunSucceededUsageCollapsed, lines: terminalByRun[60] },
};
/** Usage open, the Models table collapsed. */
export const RunSucceededUsageModelsCollapsed: Story = {
  decorators: artboard(1440, 900),
  globals: viewport(1440, 900),
  args: { data: runUsageDetails.RunSucceededUsageModelsCollapsed, lines: terminalByRun[60] },
};
/** Two priced models. */
export const RunSucceededUsageMultiModel: Story = {
  decorators: artboard(1440, 900),
  globals: viewport(1440, 900),
  args: { data: runUsageDetails.RunSucceededUsageMultiModel, lines: terminalByRun[60] },
};
/** One model had no price when recorded: "at least" and the partial note; a long model name is cut. */
export const RunSucceededUsageUnpriced: Story = {
  decorators: artboard(1440, 900),
  globals: viewport(1440, 900),
  args: { data: runUsageDetails.RunSucceededUsageUnpriced, lines: terminalByRun[60] },
};
/** Large totals with a partial note. */
export const RunSucceededUsagePartial: Story = {
  decorators: artboard(1440, 900),
  globals: viewport(1440, 900),
  args: { data: runUsageDetails.RunSucceededUsagePartial, lines: terminalByRun[60] },
};
/** No model was priced: the cost is a dash. */
export const RunSucceededUsageNonePriced: Story = {
  decorators: artboard(1440, 900),
  globals: viewport(1440, 900),
  args: { data: runUsageDetails.RunSucceededUsageNonePriced, lines: terminalByRun[60] },
};
/** The output line shows how many of its tokens were reasoning. */
export const RunSucceededUsageReasoning: Story = {
  decorators: artboard(1440, 900),
  globals: viewport(1440, 900),
  args: { data: runUsageDetails.RunSucceededUsageReasoning, lines: terminalByRun[60] },
};
/** A run that used no tokens: zeros and ~$0.00. */
export const RunSucceededUsageZero: Story = {
  decorators: artboard(1440, 900),
  globals: viewport(1440, 900),
  args: { data: runUsageDetails.RunSucceededUsageZero, lines: terminalByRun[60] },
};
/** No usage recorded for this run. */
export const RunSucceededUsageNone: Story = {
  decorators: artboard(1440, 900),
  globals: viewport(1440, 900),
  args: { data: runUsageDetails.RunSucceededUsageNone, lines: terminalByRun[60] },
};
/** Prices recorded on different days: the note gives the range. */
export const RunSucceededUsagePriceRange: Story = {
  decorators: artboard(1440, 900),
  globals: viewport(1440, 900),
  args: { data: runUsageDetails.RunSucceededUsagePriceRange, lines: terminalByRun[60] },
};
/** Run 61 running: usage so far. */
export const RunRunningUsage: Story = {
  decorators: artboard(1440, 900),
  globals: viewport(1440, 900),
  args: { data: runUsageDetails.RunRunningUsage, lines: terminalByRun[61] },
};
/** Run 61 reconnecting: the cached usage stays on screen. */
export const RunRunningUsageReconnecting: Story = {
  decorators: artboard(1440, 900),
  globals: viewport(1440, 900),
  args: { data: runUsageDetails.RunRunningUsageReconnecting, lines: terminalByRun[61] },
};

// The run page inside the shell: the shell draws the bar and the project menu; the page draws its header (title, facts
// and the run actions) over the terminal and the context panel. The confirms hang under their header buttons.
const runCrumbs = (n: number) => [{ label: 'Runs', href: '#runs' }, { label: `Run ${n}` }];
const shellRun = (
  data: (typeof runDetails)[keyof typeof runDetails],
  lines: React.ComponentProps<typeof RunDetail>['lines'],
  frame: Partial<ProjectShellFrameProps> = {},
  props: Partial<React.ComponentProps<typeof RunDetail>> = {},
) => (
  <ProjectShellFrame page="runs" crumbs={runCrumbs(data.run.id)} {...frame}>
    <RunDetail
      data={data}
      lines={lines}
      onCancel={() => undefined}
      onFinish={() => undefined}
      onStopOpen={() => undefined}
      onStop={() => undefined}
      onCancelClose={() => undefined}
      onStopClose={() => undefined}
      onTogglePanel={() => undefined}
      {...props}
    />
  </ProjectShellFrame>
);

export const RunIdle1024: Story = {
  name: 'Run needs you at 1024px',
  decorators: artboard(1024, 900),
  globals: viewport(1024, 900),
  args: { data: runDetails.RunIdle, lines: terminalByRun[62] },
  render: () => shellRun(runDetails.RunIdle, terminalByRun[62], { collapsed: true }),
};
export const RunIdleSideCollapsed: Story = {
  name: 'Run needs you, menu collapsed, actions in the page header',
  decorators: artboard(1440, 900),
  globals: viewport(1440, 900),
  args: { data: runDetails.RunIdle, lines: terminalByRun[62] },
  render: () => shellRun(runDetails.RunIdle, terminalByRun[62], { collapsed: true }),
};
export const RunIdleSideExpanded: Story = {
  name: 'Run needs you, menu expanded',
  decorators: artboard(1440, 900),
  globals: viewport(1440, 900),
  args: { data: runDetails.RunIdle, lines: terminalByRun[62] },
  render: () => shellRun(runDetails.RunIdle, terminalByRun[62]),
};
export const RunRunningSideMenu: Story = {
  name: 'Running, cancel confirm under the header button',
  decorators: artboard(1440, 900),
  globals: viewport(1440, 900),
  args: { data: runDetails.RunRunning, lines: terminalByRun[61] },
  render: () => shellRun(runDetails.RunRunning, terminalByRun[61], {}, { cancelConfirmOpen: true }),
};
export const RunRunningStopSideMenu: Story = {
  name: 'Running, stop confirm under the header button',
  decorators: artboard(1440, 900),
  globals: viewport(1440, 900),
  args: { data: runDetails.RunRunningStop, lines: terminalByRun[61] },
  render: () => shellRun(runDetails.RunRunningStop, terminalByRun[61], {}, { stopConfirmOpen: true }),
};

// BR-60, BR-65, BR-66: the run page at 390x844. The page header wraps (the run actions on their own row), the view
// switch swaps the terminal and the context panel, and the extra keys sit directly under a live terminal that accepts
// typing (`onKey` given). The shell frame is the real phone shell; the board's own drawn bar is not copied.
const phoneArtboard: NonNullable<Story['decorators']> = [
  (S) => (
    <div style={{ width: 390, height: 844 }}>
      <S />
    </div>
  ),
];
const phoneRun = (
  data: (typeof runDetails)[keyof typeof runDetails],
  lines: React.ComponentProps<typeof RunDetail>['lines'],
  props: Partial<React.ComponentProps<typeof RunDetail>> = {},
) => shellRun(data, lines, { height: 844, fill: true }, { ...props });
const openDetails = async ({ canvasElement }: { canvasElement: HTMLElement }) => {
  await userEvent.click(within(canvasElement).getByRole('radio', { name: 'Details' }));
};
export const RunIdlePhone: Story = {
  name: 'Phone: needs you, with the extra keys',
  decorators: phoneArtboard,
  globals: viewport(390, 844),
  args: { data: runDetails.RunIdle, lines: terminalByRun[62] },
  render: () => phoneRun(runDetails.RunIdle, terminalByRun[62], { onKey: () => undefined }),
};
export const RunIdlePhoneDetails: Story = {
  name: 'Phone: needs you, Details view',
  decorators: phoneArtboard,
  globals: viewport(390, 844),
  args: { data: runDetails.RunIdle, lines: terminalByRun[62] },
  render: () => phoneRun(runDetails.RunIdle, terminalByRun[62], { onKey: () => undefined }),
  play: openDetails,
};
/** Connection lost: the overlay shows and the key row does not (no `onKey`). */
export const RunReconnectPhone: Story = {
  name: 'Phone: connection lost, no keys',
  decorators: phoneArtboard,
  globals: viewport(390, 844),
  args: { data: runDetails.RunReconnect, lines: terminalByRun[61] },
  render: () => phoneRun(runDetails.RunReconnect, terminalByRun[61]),
};
export const RunRunningPhoneCancelConfirm: Story = {
  name: 'Phone: running, cancel confirm full width',
  decorators: phoneArtboard,
  globals: viewport(390, 844),
  args: { data: runDetails.RunRunning, lines: terminalByRun[61] },
  render: () => phoneRun(runDetails.RunRunning, terminalByRun[61], { cancelConfirmOpen: true, onKey: () => undefined }),
};
/** Stopped: the saved Transcript, read-only, with no key row. */
export const RunStoppedPhone: Story = {
  name: 'Phone: stopped, transcript, no keys',
  decorators: phoneArtboard,
  globals: viewport(390, 844),
  args: { data: runDetails.RunStopped },
  render: () =>
    phoneRun(runDetails.RunStopped, undefined, {
      transcript: { state: 'ready', items: transcriptFixtures.default, hasEarlier: true },
      onResume: () => undefined,
    }),
};
