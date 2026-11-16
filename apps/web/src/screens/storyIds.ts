import { toId, storyNameFromExport } from 'storybook/internal/csf';

export interface BoardStory {
  title: string;
  exportName: string;
}

const entry = 'Screens/Entry';
const setup = 'Screens/Setup';
const runs = 'Screens/Runs';
const detail = 'Screens/Run detail';
const terminalArea = 'Screens/RunTerminalArea';
const desk = 'Screens/Desk';

/** The 34 boards of design/prototype/project/canvas.json, in canvas order. */
export const boardStories = {
  Main: { title: 'Screens/Overview', exportName: 'Main' },
  NeedsYou: { title: runs, exportName: 'NeedsYou' },
  SignIn: { title: entry, exportName: 'SignIn' },
  ProjectsEmpty: { title: entry, exportName: 'ProjectsEmpty' },
  Projects: { title: entry, exportName: 'Projects' },
  Setup1: { title: setup, exportName: 'Setup1' },
  Setup1Polling: { title: setup, exportName: 'Setup1Polling' },
  Setup1PollingOk: { title: setup, exportName: 'Setup1PollingOk' },
  Setup2: { title: setup, exportName: 'Setup2' },
  SetupWorkspace: { title: setup, exportName: 'SetupWorkspace' },
  Setup3: { title: setup, exportName: 'Setup3' },
  Setup4: { title: setup, exportName: 'Setup4' },
  SetupReady: { title: setup, exportName: 'SetupReady' },
  Runs: { title: runs, exportName: 'Runs' },
  RunsProblems: { title: runs, exportName: 'RunsProblems' },
  RunStarting: { title: detail, exportName: 'RunStarting' },
  RunRunning: { title: detail, exportName: 'RunRunning' },
  RunIdle: { title: detail, exportName: 'RunIdle' },
  RunReconnect: { title: detail, exportName: 'RunReconnect' },
  RunSucceeded: { title: detail, exportName: 'RunSucceeded' },
  RunPrompt: { title: detail, exportName: 'RunPrompt' },
  RunFailed: { title: detail, exportName: 'RunFailed' },
  RunSetupFailed: { title: detail, exportName: 'RunSetupFailed' },
  RunTimedOut: { title: detail, exportName: 'RunTimedOut' },
  RunCancelled: { title: detail, exportName: 'RunCancelled' },
  DeskSkills: { title: desk, exportName: 'DeskSkills' },
  DeskSkillDelete: { title: desk, exportName: 'DeskSkillDelete' },
  DeskRules: { title: desk, exportName: 'DeskRules' },
  DeskRulesPrompt: { title: desk, exportName: 'DeskRulesPrompt' },
  DeskRulesPromptNew: { title: desk, exportName: 'DeskRulesPromptNew' },
  DeskRulesPromptError: { title: desk, exportName: 'DeskRulesPromptError' },
  DeskAgent: { title: desk, exportName: 'DeskAgent' },
  DeskSetup: { title: desk, exportName: 'DeskSetup' },
  DeskSetupTest: { title: desk, exportName: 'DeskSetupTest' },
} as const satisfies Record<string, BoardStory>;

export type BoardName = keyof typeof boardStories;

/** Screen states with no board of their own in canvas.json. Each one is a variant of `board`. */
export const stateStories = {
  Setup1PollingFailed: { title: setup, exportName: 'Setup1PollingFailed', board: 'Setup1PollingOk' },
  SetupReadyWithWarning: { title: setup, exportName: 'SetupReadyWithWarning', board: 'SetupReady' },
  SetupReadyPolling: { title: setup, exportName: 'SetupReadyPolling', board: 'SetupReady' },
  RunsProblemsPolling: { title: runs, exportName: 'RunsProblemsPolling', board: 'RunsProblems' },
  RunsProblemsEmpty: { title: runs, exportName: 'RunsProblemsEmpty', board: 'RunsProblems' },
  NeedsYouNone: { title: runs, exportName: 'NeedsYouNone', board: 'NeedsYou' },
  NeedsYouPaused: { title: runs, exportName: 'NeedsYouPaused', board: 'NeedsYou' },
  RunPaused: { title: detail, exportName: 'RunPaused', board: 'RunIdle' },
  RunPausedResuming: { title: detail, exportName: 'RunPausedResuming', board: 'RunIdle' },
  RunResumeFailed: { title: detail, exportName: 'RunResumeFailed', board: 'RunIdle' },
  RunSucceededKept: { title: detail, exportName: 'RunSucceededKept', board: 'RunSucceeded' },
  RunExpired: { title: detail, exportName: 'RunExpired', board: 'RunCancelled' },
  DeskAgentPolling: { title: desk, exportName: 'DeskAgentPolling', board: 'DeskAgent' },
  DeskAgentCheckingNow: { title: desk, exportName: 'DeskAgentCheckingNow', board: 'DeskAgent' },
  DeskAgentCheckNowRefused: { title: desk, exportName: 'DeskAgentCheckNowRefused', board: 'DeskAgent' },
  DeskRulesNewRuleError: { title: desk, exportName: 'DeskRulesNewRuleError', board: 'DeskRules' },
  Setup4Prompt: { title: setup, exportName: 'Setup4Prompt', board: 'Setup4' },
  DeskAgentSaveErrors: { title: desk, exportName: 'DeskAgentSaveErrors', board: 'DeskAgent' },
  DeskSkillsSetupWarning: { title: desk, exportName: 'DeskSkillsSetupWarning', board: 'DeskSkills' },
  DeskSetupStale: { title: desk, exportName: 'DeskSetupStale', board: 'DeskSetup' },
  DeskSetupConflict: { title: desk, exportName: 'DeskSetupConflict', board: 'DeskSetup' },
  DeskSetupEmpty: { title: desk, exportName: 'DeskSetupEmpty', board: 'DeskSetup' },
  DeskSetupVersionsError: { title: desk, exportName: 'DeskSetupVersionsError', board: 'DeskSetup' },
  DeskSetupLoading: { title: desk, exportName: 'DeskSetupLoading', board: 'DeskSetup' },
  DeskSetupLoadError: { title: desk, exportName: 'DeskSetupLoadError', board: 'DeskSetup' },
  RunTerminalAreaDone: { title: terminalArea, exportName: 'Done', board: 'RunIdle' },
  RunTerminalAreaNeedsYouWithNote: { title: terminalArea, exportName: 'NeedsYouWithNote', board: 'RunIdle' },
  RunTerminalAreaPausing: { title: terminalArea, exportName: 'Pausing', board: 'RunIdle' },
  RunTerminalAreaInactiveClosed: { title: terminalArea, exportName: 'InactiveClosed', board: 'RunIdle' },
  RunTerminalAreaPausedIdleTimeout: { title: terminalArea, exportName: 'PausedIdleTimeout', board: 'RunIdle' },
  RunTerminalAreaPausedPodLost: { title: terminalArea, exportName: 'PausedPodLost', board: 'RunIdle' },
  RunTerminalAreaPausedAgentCrashed: { title: terminalArea, exportName: 'PausedAgentCrashed', board: 'RunIdle' },
  RunTerminalAreaResumed: { title: terminalArea, exportName: 'Resumed', board: 'RunIdle' },
  RunTerminalAreaExpired: { title: terminalArea, exportName: 'Expired', board: 'RunCancelled' },
  RunTerminalAreaResuming: { title: terminalArea, exportName: 'Resuming', board: 'RunStarting' },
  RunTerminalAreaResumeFailedNothingKept: {
    title: terminalArea,
    exportName: 'ResumeFailedNothingKept',
    board: 'RunSucceeded',
  },
  SetupWorkspaceStart: { title: setup, exportName: 'SetupWorkspaceStart', board: 'SetupWorkspace' },
  SetupWorkspaceRunning: { title: setup, exportName: 'SetupWorkspaceRunning', board: 'SetupWorkspace' },
  SetupWorkspaceFailed: { title: setup, exportName: 'SetupWorkspaceFailed', board: 'SetupWorkspace' },
} as const satisfies Record<string, BoardStory & { board: BoardName }>;

/** Storybook's own id rule: toId(title, startCase(exportName)), e.g. `screens-run-detail--run-starting`. */
export function storyId(board: BoardName): string {
  const { title, exportName } = boardStories[board];
  return toId(title, storyNameFromExport(exportName));
}

/** Relative link that switches the Storybook manager to a board's story. */
export function storyHref(board: BoardName): string {
  return `?path=/story/${storyId(board)}`;
}
