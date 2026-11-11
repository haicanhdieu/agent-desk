import { toId, storyNameFromExport } from 'storybook/internal/csf';

export interface BoardStory { title: string; exportName: string }

const entry = 'Screens/Entry';
const setup = 'Screens/Setup';
const runs = 'Screens/Runs';
const detail = 'Screens/Run detail';
const desk = 'Screens/Desk';

/** The 24 boards of design/prototype/project/canvas.json, in canvas order. */
export const boardStories = {
  Main: { title: 'Screens/Overview', exportName: 'Main' },
  NeedsYou: { title: runs, exportName: 'NeedsYou' },
  SignIn: { title: entry, exportName: 'SignIn' },
  ProjectsEmpty: { title: entry, exportName: 'ProjectsEmpty' },
  Projects: { title: entry, exportName: 'Projects' },
  Setup1: { title: setup, exportName: 'Setup1' },
  Setup2: { title: setup, exportName: 'Setup2' },
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
  RunFailed: { title: detail, exportName: 'RunFailed' },
  RunTimedOut: { title: detail, exportName: 'RunTimedOut' },
  RunCancelled: { title: detail, exportName: 'RunCancelled' },
  DeskSkills: { title: desk, exportName: 'DeskSkills' },
  DeskSkillDelete: { title: desk, exportName: 'DeskSkillDelete' },
  DeskRules: { title: desk, exportName: 'DeskRules' },
  DeskAgent: { title: desk, exportName: 'DeskAgent' },
} as const satisfies Record<string, BoardStory>;

export type BoardName = keyof typeof boardStories;

/** Storybook's own id rule: toId(title, startCase(exportName)), e.g. `screens-run-detail--run-starting`. */
export function storyId(board: BoardName): string {
  const { title, exportName } = boardStories[board];
  return toId(title, storyNameFromExport(exportName));
}

/** Relative link that switches the Storybook manager to a board's story. */
export function storyHref(board: BoardName): string {
  return `?path=/story/${storyId(board)}`;
}
