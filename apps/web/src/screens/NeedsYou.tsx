import { AppLink, Button, Icon, StatusBadge } from '@/ds';
import {
  GitHubComment,
  Pagination,
  ProjectMenu,
  ProjectStrip,
  SurfaceCard,
  TopBar,
  type PaginationProps,
  type OrgSwitchProps,
} from '@/components';
import { menuWarning } from '@/mocks/connection';
import { runs as runFixtures } from '@/mocks';
import type { Actor, Project, RunSummary } from '@/mocks/types';
import styles from './Screens.module.css';
import mock from './NeedsYou.module.css';

/** A run waiting for someone: the run, its in-app href, when it went idle and when it ends on its own ("HH:mm"). */
export interface NeedsYouRun {
  run: RunSummary;
  href: string;
  idleAt: string;
  endsAt: string;
}

export interface NeedsYouProps {
  project: Project;
  projects: Project[];
  /** Idle and paused runs of the project; defaults to the board's Run 62. */
  runs?: NeedsYouRun[];
  /** Resume a paused run (its row has a Resume button); `resuming` is the number of the run being resumed. */
  onResume?(run: RunSummary): void;
  /** Whether the viewer may resume this run (a member only their own; never a viewer). Without it no row has Resume. */
  canResume?(run: RunSummary): boolean;
  resuming?: number;
  /** Href of a project in the switcher; defaults to '#'. */
  projectHref?(p: Project): string;
  /** The page control, drawn under the run cards; the cards are aria-busy while it loads. */
  pagination?: PaginationProps;
  /** In the app the page gets the org bar (Projects and Settings tabs, none current); the board has none. */
  topBar?: {
    user: Actor;
    org: OrgSwitchProps;
  };
}

const boardRun = runFixtures.find((r) => r.id === 62);
const boardRuns: NeedsYouRun[] = boardRun
  ? [{ run: boardRun, href: '/runs/62', idleAt: '14:13', endsAt: '14:43' }]
  : [];

const ticketLabel = (r: RunSummary) => `${r.ticket.kind === 'pr' ? 'PR' : 'issue'} #${r.ticket.number}`;

export function NeedsYou({
  project,
  projects,
  runs = boardRuns,
  onResume,
  canResume = () => false,
  resuming,
  projectHref = () => '#',
  topBar,
  pagination,
}: NeedsYouProps) {
  // The desktop notification is for a run that asked something; a paused run has nothing to ask.
  const first = runs.find((r) => r.run.status === 'idle');
  const none = <p className={`muted ${mock.none}`}>No runs need you right now.</p>;
  const main = (
    <main className={styles.needsMain}>
      <div className={styles.needsHead}>
        <h1>Where "needs you" shows up</h1>
        <p className={`muted ${styles.needsIntro}`}>
          An idle run holds a slot and ends on its own after 30 minutes with no one attached, so the signal has to reach
          you in GitHub, in another tab, or in another project. Same amber, same caret icon, same words everywhere.
        </p>
      </div>
      <div className={styles.needsGrid}>
        <SurfaceCard caption="Browser tab: title prefix with the count of runs that need you, and an amber dot on the favicon. Updates over the existing status stream (SSE).">
          <div className={mock.tabStrip}>
            <div className={mock.tabActive}>
              <span className={mock.favicon}>
                <Icon name="brand" size={16} />
                <i className={mock.faviconDot} />
              </span>
              ({project.needsYou}) Needs you, {project.name}
            </div>
            <div className={mock.tabIdle}>
              <svg
                aria-hidden="true"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="12" cy="12" r="9" />
                <path d="M8.5 12.5 11 15l4.5-5.5" />
              </svg>
              Export invoices as CSV, PR #148
            </div>
          </div>
        </SurfaceCard>
        <SurfaceCard caption="In the app: badge on the Runs tab, per-project counts in the switcher, a pinned banner at the top of Runs, and amber rows in the list.">
          <ProjectStrip project={project.name} active="runs" needsYou={project.needsYou} />
          <div className={mock.menuWrap}>
            <ProjectMenu
              items={projects.map((p) => ({
                name: p.name,
                needsYou: p.needsYou,
                warning: menuWarning(p.connection),
                warningTone: p.connection.tone === 'err' ? 'err' : 'idle',
                current: p.id === project.id,
                href: projectHref(p),
              }))}
            />
          </div>
        </SurfaceCard>
        <SurfaceCard caption='On GitHub: the bot edits its own start comment as the run changes state, so the ticket shows "waiting for your input" without a new comment or extra notification noise.'>
          {runs.length === 0 && none}
          <div className={mock.cards} aria-busy={pagination?.busy || undefined}>
            {runs.map(({ run, href, idleAt, endsAt }) =>
              run.status === 'paused' ? (
                <GitHubComment
                  key={run.id}
                  author="agent-desk[bot]"
                  bot
                  meta={`commented on ${ticketLabel(run)}, edited ${idleAt}`}
                >
                  <span>{`Run ${run.id} is paused and can be resumed.`}</span>
                  <span className={`muted ${styles.ghSub}`}>{run.statusNote}</span>
                  <span className={mock.pausedActions}>
                    <StatusBadge status="paused" variant="pill" />
                    {canResume(run) && (
                      <Button
                        size="sm"
                        variant="go"
                        icon="play"
                        disabled={resuming !== undefined}
                        onClick={() => onResume?.(run)}
                      >
                        Resume
                      </Button>
                    )}
                  </span>
                  <AppLink href={href}>Open run {run.id} in Agent Desk</AppLink>
                </GitHubComment>
              ) : (
                <GitHubComment
                  key={run.id}
                  author="agent-desk[bot]"
                  bot
                  meta={`commented on ${ticketLabel(run)}, edited ${idleAt}`}
                >
                  <span>
                    <b>Run {run.id}</b> <span className="mono">{run.skill}</span> is waiting for your input.
                  </span>
                  <span className={`muted ${styles.ghSub}`}>
                    Started {run.startedAt} by a <span className="mono">{run.command}</span> comment from{' '}
                    {run.triggeredBy.login}. It ends on its own at {endsAt} if nobody opens it.
                  </span>
                  <AppLink href={href}>Open run {run.id} in Agent Desk</AppLink>
                </GitHubComment>
              ),
            )}
            {pagination && runs.length > 0 && <Pagination {...pagination} />}
          </div>
        </SurfaceCard>
        <SurfaceCard caption="Desktop notification, opt-in from the bell in the top bar. Sent once when a run becomes idle, again 2 minutes before auto-finish.">
          {first ? (
            <div className={mock.notify}>
              <Icon name="brand" size={28} strokeWidth={1.4} />
              <div className={mock.notifyText}>
                <b>Run {first.run.id} needs you</b>
                <span className="muted">
                  {first.run.skill} on {ticketLabel(first.run)} asked a question
                </span>
              </div>
            </div>
          ) : (
            none
          )}
        </SurfaceCard>
      </div>
    </main>
  );
  if (!topBar) return main;
  return (
    <>
      <TopBar variant="global" tabs="org" user={topBar.user} org={topBar.org} />
      {main}
    </>
  );
}
