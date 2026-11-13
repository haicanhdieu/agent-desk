import {
  PutSetupScriptRequest,
  SetupScriptBody,
  type PluginsDto,
  type RunEventDto,
  type SetupScriptDto,
  type SetupScriptVersionDto,
  type SetupTestDto,
} from '@agentdesk/contracts';
import { z } from 'zod';
import type { ScriptVersion, SetupPhase, TermLine, TermTone } from '@/components';
import type { DeskSetupProps, LastSetupTest, SetupStepTest, SetupTestView } from '@/screens';
import { relativeTime } from '../relativeTime';
import { plainLines, SCROLLBACK_MAX_LINES } from '../runs/detail.map';
import { clockTime } from '../runs/map';

/** What the Desk Setup screen shows, without the frame and the callbacks the route adds. */
export type SetupViewProps = Omit<
  DeskSetupProps,
  'frame' | 'onSave' | 'onTest' | 'onEndTest' | 'onViewLog' | 'onViewVersion' | 'onRestore'
>;

export interface SetupData {
  script: SetupScriptDto | null;
  versions: SetupScriptVersionDto[];
  plugins: PluginsDto;
  latest: SetupTestDto | null;
  events: RunEventDto[];
}

const SHA7 = 7;
const NOTE_MAX = 200;

/**
 * What stops a save or a test before it is sent: the script over 64 KiB (UTF-8 bytes, the contract's own message), a
 * change note over 200 characters. Undefined when the request is fine.
 */
export function setupScriptSaveProblem(script: string, note: string): string | undefined {
  const body = SetupScriptBody.safeParse(script);
  if (!body.success) return body.error.issues[0]?.message ?? 'The setup script is not valid.';
  if (!PutSetupScriptRequest.shape.note.safeParse(note.trim()).success) {
    return `Change note is longer than ${NOTE_MAX} characters`;
  }
  return undefined;
}

// The runner's log markers and output chunks arrive as `lifecycle` run events (packages/core's LogLineKind). Payloads
// are untrusted: only this shape is read, anything else is skipped.
const KINDS = [
  'checkout',
  'plugins_begin',
  'plugin_installed',
  'plugin_skipped',
  'plugin_failed',
  'plugins_end',
  'setup_begin',
  'setup_skipped',
  'setup_passed',
  'setup_failed',
  'setup_timed_out',
  'setup_output',
  'plugin_output',
] as const;
const Payload = z.object({
  kind: z.enum(KINDS),
  text: z.string().optional(),
  pluginId: z.string().optional(),
  sha: z.string().optional(),
  exitCode: z.number().int().optional(),
  truncated: z.boolean().optional(),
});
type Payload = z.infer<typeof Payload>;
type Kind = (typeof KINDS)[number];

interface Parsed {
  ts: number;
  p: Payload;
}

const parseEvents = (events: RunEventDto[]): Parsed[] =>
  events.flatMap((e) => {
    if (e.type !== 'lifecycle') return [];
    const p = Payload.safeParse(e.payload);
    return p.success ? [{ ts: Date.parse(e.ts), p: p.data }] : [];
  });

/** "48s", "2m 31s". */
function shortDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return total < 60 ? `${total}s` : `${Math.floor(total / 60)}m ${total % 60}s`;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
/**
 * Ended: the workspace is gone. The backend sets `endedAt` for every test; `status` becomes `ended` only when no
 * result was recorded, so a test that passed and was later ended keeps status `passed` with `endedAt` set.
 */
const isEnded = (t: SetupTestDto) => t.endedAt !== null || t.status === 'ended';
const isOpen = (t: SetupTestDto) => !isEnded(t);
const settled = (t: SetupTestDto) => t.status === 'passed' || t.status === 'failed';

/** The plugin ids each state holds: from the events in order, then what only the test row knows. */
function pluginStates(
  test: SetupTestDto,
  parsed: Parsed[],
): { id: string; state: 'installed' | 'skipped' | 'failed' }[] {
  const out: { id: string; state: 'installed' | 'skipped' | 'failed' }[] = [];
  const add = (id: string | undefined, state: 'installed' | 'skipped' | 'failed') => {
    if (id !== undefined && !out.some((o) => o.id === id)) out.push({ id, state });
  };
  const byKind = { plugin_installed: 'installed', plugin_skipped: 'skipped', plugin_failed: 'failed' } as const;
  for (const { p } of parsed) if (p.kind in byKind) add(p.pluginId, byKind[p.kind as keyof typeof byKind]);
  for (const id of test.plugins.installed) add(id, 'installed');
  for (const id of test.plugins.skipped) add(id, 'skipped');
  for (const id of test.plugins.failed) add(id, 'failed');
  return out;
}

function phasesOf(test: SetupTestDto, parsed: Parsed[], plugins: { state: string }[], now: Date): SetupPhase[] {
  const first = (...kinds: Kind[]) => parsed.find((x) => kinds.some((k) => k === x.p.kind));
  const checkout = first('checkout');
  const sha = checkout?.p.sha ?? test.checkoutSha ?? undefined;
  const cloned = checkout !== undefined || test.checkoutSha !== null;
  const begin = first('setup_begin');
  const result = first('setup_skipped', 'setup_passed', 'setup_failed', 'setup_timed_out');
  const pluginsDone = first('plugins_end') !== undefined || begin !== undefined || result !== undefined;

  const clone: SetupPhase = cloned
    ? { label: 'Clone', state: 'done', ...(sha !== undefined && { detail: sha.slice(0, SHA7) }) }
    : { label: 'Clone', state: settled(test) ? 'failed' : 'active' };

  const count = (s: string) => plugins.filter((p) => p.state === s).length;
  const counts = [
    count('installed') > 0 && `${count('installed')} installed`,
    count('skipped') > 0 && `${count('skipped')} blocked`,
    count('failed') > 0 && `${count('failed')} failed`,
  ].filter((x): x is string => x !== false);
  const pluginsPhase: SetupPhase = pluginsDone
    ? { label: 'Plugins', state: 'done', detail: counts.length > 0 ? counts.join(', ') : 'none enabled' }
    : { label: 'Plugins', state: cloned ? 'active' : 'pending' };

  const took = begin && result ? ` after ${shortDuration(result.ts - begin.ts)}` : '';
  let setup: SetupPhase;
  switch (result?.p.kind) {
    case 'setup_skipped':
      setup = { label: 'Setup', state: 'done', detail: 'no script' };
      break;
    case 'setup_passed':
      setup = { label: 'Setup', state: 'done', detail: `exit 0${took}` };
      break;
    case 'setup_failed':
      setup = { label: 'Setup', state: 'failed', detail: `exit ${result.p.exitCode ?? test.exitCode ?? 1}${took}` };
      break;
    case 'setup_timed_out':
      setup = { label: 'Setup', state: 'failed', detail: `timed out${took}` };
      break;
    default:
      setup = begin
        ? { label: 'Setup', state: 'active', detail: `running for ${shortDuration(now.getTime() - begin.ts)}` }
        : { label: 'Setup', state: pluginsDone ? 'active' : 'pending' };
  }

  const shell: SetupPhase = settled(test)
    ? { label: 'Shell', state: 'done', detail: 'ready for you' }
    : { label: 'Shell', state: 'pending' };
  return [clone, pluginsPhase, setup, shell];
}

const markerTone: Partial<Record<Kind, TermTone>> = {
  plugin_installed: 'green',
  plugin_skipped: 'yellow',
  plugin_failed: 'red',
  setup_failed: 'red',
  setup_timed_out: 'red',
  checkout: 'accent',
  plugins_begin: 'accent',
  plugins_end: 'accent',
  setup_begin: 'accent',
  setup_skipped: 'accent',
  setup_passed: 'accent',
};

/** The test's log as terminal lines: the runner's markers toned, script and plugin output as plain text. */
function logLines(parsed: Parsed[]): TermLine[] {
  const lines: TermLine[] = [];
  for (const { p } of parsed) {
    const text = p.text ?? p.kind;
    if (p.kind === 'setup_output' || p.kind === 'plugin_output') {
      lines.push(...plainLines(text.replace(/\r?\n$/, '')));
      if (p.truncated === true) lines.push([{ text: '[output truncated]', tone: 'dim' }]);
      continue;
    }
    const tone = markerTone[p.kind];
    for (const line of plainLines(text)) {
      lines.push(line.map((span) => (tone ? { ...span, tone } : span)));
    }
  }
  return lines.slice(-SCROLLBACK_MAX_LINES);
}

function endsIn(test: SetupTestDto, now: Date): string {
  if (isEnded(test)) return 'ended';
  if (test.endsAt === null) return 'setup finishes';
  return `${Math.max(0, Math.ceil((Date.parse(test.endsAt) - now.getTime()) / 60_000))} min`;
}

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

type Result = 'passed' | 'failed';

const RESULT_KINDS: Kind[] = ['setup_passed', 'setup_skipped', 'setup_failed', 'setup_timed_out'];
const resultMarker = (parsed: Parsed[]) => parsed.find((x) => RESULT_KINDS.some((k) => k === x.p.kind));

/**
 * How setup went. The backend stores `exitCode` only for `setup_failed` (null for a pass, a skip and a timeout), so
 * the result comes from the test's result marker, else its status (`passed`/`failed` are set only when a result was
 * recorded), else a recorded finish. Undefined: no result (still running, or ended without one).
 */
function resultOf(test: SetupTestDto, parsed: Parsed[]): Result | undefined {
  const marker = resultMarker(parsed);
  if (marker) return marker.p.kind === 'setup_passed' || marker.p.kind === 'setup_skipped' ? 'passed' : 'failed';
  if (test.status === 'passed' || test.status === 'failed') return test.status;
  if (test.finishedAt !== null) return test.exitCode === null || test.exitCode === 0 ? 'passed' : 'failed';
  return undefined;
}

/** The last part of the summary: how setup ended, never an exit code the test does not have. */
function setupOutcome(test: SetupTestDto, parsed: Parsed[], result: Result): string {
  const marker = resultMarker(parsed);
  if (marker?.p.kind === 'setup_skipped') return 'setup skipped';
  if (marker?.p.kind === 'setup_timed_out') return 'setup timed out';
  const exitCode = marker?.p.exitCode ?? test.exitCode;
  if (exitCode !== null && exitCode !== undefined) return `setup exited ${exitCode}`;
  return result === 'passed' ? 'setup passed' : 'setup failed';
}

function lastTestOf(test: SetupTestDto, parsed: Parsed[], now: Date): LastSetupTest | undefined {
  const result = resultOf(test, parsed);
  if (result === undefined) return undefined;
  const created = new Date(test.createdAt);
  const when = sameDay(created, now) ? `Today ${clockTime(test.createdAt)}` : relativeTime(test.createdAt, now);
  const took = test.finishedAt === null ? '' : `, ${shortDuration(Date.parse(test.finishedAt) - created.getTime())}`;
  const { installed, skipped, failed } = test.plugins;
  const parts = [
    test.checkoutSha !== null && 'Clone',
    installed.length > 0 && `${plural(installed.length, 'plugin', 'plugins')} installed`,
    skipped.length > 0 && `${skipped.length} blocked`,
    failed.length > 0 && `${failed.length} failed`,
    setupOutcome(test, parsed, result),
  ].filter((x): x is string => x !== false);
  return {
    result,
    matchesSaved: test.matchesCurrentScript,
    summary: `${when} by ${test.startedBy}${took}. ${parts.join(', ')}.`,
  };
}

function testView(test: SetupTestDto, parsed: Parsed[], script: SetupScriptDto | null, now: Date, ended: boolean) {
  const states = pluginStates(test, parsed);
  // A test that ended without a result shows as failed in its log.
  const status: SetupTestView['status'] = resultOf(test, parsed) ?? (isEnded(test) ? 'failed' : 'running');
  const sha = test.checkoutSha ?? parsed.find((x) => x.p.kind === 'checkout')?.p.sha;
  const view: SetupTestView = {
    status,
    phases: phasesOf(test, parsed, states, now),
    plugins: states,
    lines: logLines(parsed),
    ...(ended && { view: 'log' as const }),
    scriptLabel: test.matchesCurrentScript && script !== null ? `Version ${script.version}` : 'Draft, not saved',
    checkout: sha === undefined ? 'Cloning…' : sha.slice(0, SHA7),
    started: clockTime(test.createdAt),
    endsIn: endsIn(test, now),
    ...(settled(test) && !ended && { attachedAs: test.startedBy }),
  };
  return view;
}

/**
 * The Desk Setup screen's data (spec §5.5). `latest` is the project's newest setup test and `events` its log (from
 * the stream); an open test (not ended) is the test workspace, a finished one also gives the last-test banner.
 * `showEnded` opens an ended test as a read-only log. Times are local; `now` is `useNow()`.
 */
export function toDeskSetupProps(data: SetupData, now: Date, opts: { showEnded?: boolean } = {}): SetupViewProps {
  const { script, versions, plugins, latest, events } = data;
  const parsed = parseEvents(events);
  const open = latest !== null && (isOpen(latest) || opts.showEnded === true);
  const lastTest = latest === null ? undefined : lastTestOf(latest, parsed, now);
  return {
    script:
      script === null
        ? null
        : {
            version: script.version,
            body: script.body,
            savedBy: script.createdBy,
            savedAgo: relativeTime(script.createdAt, now),
          },
    plugins: {
      plugins: plugins.settingsError === null ? plugins.plugins.map(({ id, state }) => ({ id, state })) : [],
      ...(plugins.settingsError !== null && { error: 'Could not read .claude/settings.json from the repository.' }),
    },
    versions: versions.map((v): ScriptVersion => ({
      version: v.version,
      author: v.createdBy,
      ago: relativeTime(v.createdAt, now),
      ...(v.note !== null && { note: v.note }),
    })),
    ...(lastTest && { lastTest }),
    ...(latest !== null && open && { test: testView(latest, parsed, script, now, !isOpen(latest)) }),
  };
}

/**
 * The onboarding step's test panel from the Desk Setup view: idle without an open test, running with the phase it is
 * in, passed or failed with the same summary line as the Desk's last-test banner.
 */
export function toSetupStepTest(view: Pick<SetupViewProps, 'test' | 'lastTest'>): SetupStepTest {
  const { test, lastTest } = view;
  if (test === undefined) return { state: 'idle' };
  if (test.status === 'running') {
    const phase = test.phases.find((p) => p.state === 'active');
    const detail = phase ? `${phase.label}${phase.detail ? `: ${phase.detail}` : ''}` : 'Starting the workspace';
    return { state: 'running', detail };
  }
  return {
    state: test.status,
    title: test.status === 'passed' ? 'Setup passed' : 'Setup failed',
    detail: lastTest?.summary ?? '',
  };
}

/** A setup warning (spec §5.5, "warn, don't block"): what to tell the person, never a reason to stop them. */
export interface SetupWarning {
  kind: 'failed' | 'changed' | 'untested';
  title: string;
  detail: string;
}

/**
 * Warns when the project has a saved script and the latest test of that script failed, or no passing test matches the
 * script (it changed since the last passing test, or it was never tested). A project without a script (none saved, or
 * an empty one) has nothing to warn about, even if a draft was tested; a failed test of an unsaved draft is not
 * blamed on the saved script. The result is read as the Desk Setup tab reads it (status, then `finishedAt`;
 * a test that ended without a result says nothing), from the test row alone: the log is not loaded here.
 */
export function setupWarningOf(script: SetupScriptDto | null, latest: SetupTestDto | null): SetupWarning | undefined {
  if (script === null || script.body === '') return undefined;
  const result = latest === null ? undefined : resultOf(latest, []);
  if (latest !== null && result === 'failed' && latest.matchesCurrentScript) {
    return {
      kind: 'failed',
      title: 'The last workspace setup test failed',
      detail: 'Runs still start, but setup may fail in them. Open Workspace setup to see the log.',
    };
  }
  if (latest !== null && result === 'passed' && latest.matchesCurrentScript) return undefined;
  if (latest !== null && result === 'passed') {
    return {
      kind: 'changed',
      title: 'The setup script changed since the last passing test',
      detail: 'Runs use the saved script as it is. Test it again to be sure it still works.',
    };
  }
  return {
    kind: 'untested',
    title: 'The setup script has not passed a test yet',
    detail: 'Runs use the saved script as it is. Test it in Workspace setup to be sure it works.',
  };
}
