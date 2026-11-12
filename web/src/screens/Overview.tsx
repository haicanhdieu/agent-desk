import { Brand } from '@/components';
import { StatusBadge } from '@/ds';
import type { RunStatus } from '@/ds/tokens';
import tokensCss from '@/ds/tokens.css?raw';
import { storyHref, type BoardName } from './storyIds';
import styles from './Overview.module.css';

const groups: { heading: string; items: { board: BoardName; label: string }[] }[] = [
  { heading: 'Entry', items: [
    { board: 'SignIn', label: 'Sign in with GitHub' },
    { board: 'ProjectsEmpty', label: 'Projects, first-time empty state' },
    { board: 'Projects', label: 'Projects list' },
  ] },
  { heading: 'First-run setup', items: [
    { board: 'Setup1', label: '1. Connect repository, webhook' },
    { board: 'Setup1Polling', label: '1. Connect repository, polling, first check' },
    { board: 'Setup1PollingOk', label: '1. Connect repository, polling connected' },
    { board: 'Setup2', label: '2. Claude credential' },
    { board: 'Setup3', label: '3. Skills from templates' },
    { board: 'Setup4', label: '4. First rule' },
    { board: 'SetupReady', label: 'Ready to trigger' },
  ] },
  { heading: 'Runs', items: [
    { board: 'Runs', label: 'Runs list, project home' },
    { board: 'RunsProblems', label: 'Runs list with health warnings and ignored commands' },
    { board: 'NeedsYou', label: 'How "needs you" reaches you outside the app' },
  ] },
  { heading: 'Run detail, live', items: [
    { board: 'RunStarting', label: 'Starting, before the terminal exists' },
    { board: 'RunRunning', label: 'Running, with cancel confirmation' },
    { board: 'RunIdle', label: 'Needs you (idle)' },
    { board: 'RunReconnect', label: 'Reconnecting, laptop 1280, panel collapsed' },
  ] },
  { heading: 'Run detail, ended', items: [
    { board: 'RunSucceeded', label: 'Succeeded, stored scrollback' },
    { board: 'RunFailed', label: 'Failed, reason above scrollback' },
    { board: 'RunTimedOut', label: 'Timed out' },
    { board: 'RunCancelled', label: 'Cancelled, no scrollback' },
  ] },
  { heading: 'Desk', items: [
    { board: 'DeskSkills', label: 'Skills and Markdown editor' },
    { board: 'DeskSkillDelete', label: 'Delete skill confirmation' },
    { board: 'DeskRules', label: 'Routing rules, list and edit' },
    { board: 'DeskAgent', label: 'Agent and settings, replace credential' },
  ] },
];

const statusNotes: Record<RunStatus, string> = {
  queued: 'Waiting for a free slot',
  starting: 'Pod scheduled, cloning, launching',
  running: 'Agent is working on its turn',
  idle: 'Agent finished its turn and waits for you (status idle)',
  succeeded: 'Ended normally, by Finish or idle timeout',
  failed: 'Agent exited non-zero or pod failed',
  timed_out: 'Hit the run time limit',
  cancelled: 'Stopped by you',
};

const statusOrder: RunStatus[] = ['queued', 'starting', 'running', 'idle', 'succeeded', 'failed', 'timed_out', 'cancelled'];

const surfaces = [
  { label: 'Ground', token: 'bg', cls: styles.ground },
  { label: 'Panel', token: 'panel', cls: styles.panel },
  { label: 'Raised', token: 'raised', cls: styles.raised },
  { label: 'Terminal', token: 'term', cls: styles.terminal },
] as const;

/** Value of a colour token, read from tokens.css so the swatch text never drifts from the token. */
function tokenValue(name: string): string {
  const m = tokensCss.match(new RegExp(`--${name}:\\s*(#[0-9A-Fa-f]{6})`));
  return m ? m[1] : '';
}

export function Overview() {
  return (
    <main className={styles.page}>
      <div className={styles.left}>
        <div className="row" style={{ gap: 12 }}>
          <Brand withName={false} size={36} />
          <span className={styles.name}>Agent Desk</span>
        </div>
        <h1 className={styles.title}>Proof-of-concept screens</h1>
        <p className={`muted ${styles.summary}`}>
          A developer delegates GitHub tickets to Claude Code runs. GitHub stays the board; Agent Desk adds routing
          rules, one container per run, and the live terminal. Each artboard on this canvas is one screen or state.
          Click a name to jump to it, or comment on any element.
        </p>
        <div className={styles.groups}>
          {groups.map((g) => (
            <section key={g.heading} className={styles.group}>
              <h2 className="h3">{g.heading}</h2>
              <ul className={styles.list}>
                {g.items.map((it) => (
                  <li key={it.board}><a href={storyHref(it.board)} target="_top">{it.label}</a></li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
      <div className={styles.right}>
        <section className={styles.legend}>
          <h2>Run status, one shape per state</h2>
          <p className={`muted ${styles.legendNote}`}>
            Colour always comes with a distinct icon and a word. Amber is reserved for runs that need you.
          </p>
          <div className={styles.statuses}>
            {statusOrder.map((s) => (
              <div key={s} className={`row ${styles.statusRow}`}>
                <span className={styles.statusCell}><StatusBadge status={s} /></span>
                <span className={`muted ${styles.statusNote}`}>{statusNotes[s]}</span>
              </div>
            ))}
          </div>
        </section>
        <section className={styles.surfaces}>
          <h2>Type and surfaces</h2>
          <div className={`row ${styles.swatches}`}>
            {surfaces.map((s) => (
              <div key={s.label} className={`muted ${styles.swatch} ${s.cls}`}>
                {s.label}<br /><span className="mono">{tokenValue(s.token)}</span>
              </div>
            ))}
          </div>
          <p className={`muted ${styles.typeNote}`}>
            IBM Plex Sans for interface text, IBM Plex Mono for commands, refs, paths and the terminal.
          </p>
        </section>
      </div>
    </main>
  );
}
