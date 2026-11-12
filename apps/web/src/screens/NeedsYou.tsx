import { Icon } from '@/ds';
import { GitHubComment, ProjectMenu, ProjectStrip, SurfaceCard } from '@/components';
import { menuWarning } from '@/mocks/connection';
import type { Project } from '@/mocks/types';
import styles from './Screens.module.css';
import mock from './NeedsYou.module.css';

export interface NeedsYouProps {
  project: Project;
  projects: Project[];
}

export function NeedsYou({ project, projects }: NeedsYouProps) {
  return (
    <main className={styles.needsMain}>
      <div className={styles.needsHead}>
        <h1>Where "needs you" shows up</h1>
        <p className={`muted ${styles.needsIntro}`}>
          An idle run holds a slot and ends on its own after 10 minutes with no one attached, so the signal has to reach you in GitHub, in another tab, or in another project. Same amber, same caret icon, same words everywhere.
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
              <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="9" /><path d="M8.5 12.5 11 15l4.5-5.5" />
              </svg>
              Export invoices as CSV, PR #148
            </div>
          </div>
        </SurfaceCard>
        <SurfaceCard caption="In the app: badge on the Runs tab, per-project counts in the switcher, a pinned banner at the top of Runs, and amber rows in the list.">
          <ProjectStrip org={project.org} project={project.name} active="runs" needsYou={project.needsYou} />
          <div className={mock.menuWrap}>
            <ProjectMenu
              items={projects.map((p) => ({
                name: p.name,
                needsYou: p.needsYou,
                warning: menuWarning(p.connection),
                warningTone: p.connection.tone === 'fail' ? 'fail' : 'idle',
                current: p.id === project.id,
                href: '#',
              }))}
            />
          </div>
        </SurfaceCard>
        <SurfaceCard caption="On GitHub: the bot edits its own start comment as the run changes state, so the ticket shows &quot;waiting for your input&quot; without a new comment or extra notification noise.">
          <GitHubComment author="agent-desk[bot]" bot meta="commented on PR #148, edited 14:13">
            <span><b>Run 62</b> <span className="mono">code-review</span> is waiting for your input.</span>
            <span className={`muted ${styles.ghSub}`}>
              Started 14:09 by a <span className="mono">/code-review</span> comment from agent-desk[bot]. It ends on its own at 14:23 if nobody opens it.
            </span>
            <a href="/runs/62">Open run 62 in Agent Desk</a>
          </GitHubComment>
        </SurfaceCard>
        <SurfaceCard caption="Desktop notification, opt-in from the bell in the top bar. Sent once when a run becomes idle, again 2 minutes before auto-finish.">
          <div className={mock.notify}>
            <Icon name="brand" size={28} strokeWidth={1.4} />
            <div className={mock.notifyText}>
              <b>Run 62 needs you</b>
              <span className="muted">code-review on PR #148 asked a question</span>
            </div>
          </div>
        </SurfaceCard>
      </div>
    </main>
  );
}
