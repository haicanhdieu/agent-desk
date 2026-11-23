import { AppLink, CountBadge, Icon } from '@/ds';
import { ProjectSwitch } from './ProjectSwitch';
import styles from './Chrome.module.css';

export interface ProjectNavProps {
  active?: 'runs' | 'desk';
  needsYou?: number;
  /** Default "/runs". */
  runsHref?: string;
  /** The Desk tab shows only when this is given: it is for roles that may read the Desk (issue 216), so none by default. */
  deskHref?: string;
  /** The nav landmark's name; the example strip on a page that has the real bar uses another one. */
  label?: string;
}

/** Runs / Desk tabs of the project top bar. */
export function ProjectNav({ active, needsYou, runsHref = '/runs', deskHref, label = 'Main' }: ProjectNavProps) {
  return (
    <nav className={styles.tabs} aria-label={label}>
      <AppLink
        href={runsHref}
        className={active === 'runs' ? styles.on : undefined}
        aria-current={active === 'runs' ? 'page' : undefined}
      >
        <Icon name="runs" size={15} />
        Runs
        <CountBadge
          count={needsYou}
          label="needs you"
          title={needsYou ? `${needsYou} ${needsYou === 1 ? 'run needs' : 'runs need'} you` : undefined}
        />
      </AppLink>
      {deskHref !== undefined && (
        <AppLink
          href={deskHref}
          className={active === 'desk' ? styles.on : undefined}
          aria-current={active === 'desk' ? 'page' : undefined}
        >
          <Icon name="desk" size={15} />
          Desk
        </AppLink>
      )}
    </nav>
  );
}

/** Project switch plus tabs on a bare top-bar strip (no brand, no right-hand actions). */
export function ProjectStrip({ project, active, needsYou }: ProjectNavProps & { project: string }) {
  return (
    <div className={`${styles.top} ${styles.stripBare}`}>
      <ProjectSwitch project={project} />
      <ProjectNav active={active} needsYou={needsYou} label="Runs and Desk tabs, example" />
    </div>
  );
}
