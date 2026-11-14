import { AppLink, CountBadge, Icon } from '@/ds';
import { ProjectSwitch } from './ProjectSwitch';
import styles from './Chrome.module.css';

export interface ProjectNavProps {
  active?: 'runs' | 'desk';
  needsYou?: number;
  /** Default "/runs". */
  runsHref?: string;
  /** Default "/desk". */
  deskHref?: string;
}

/** Runs / Desk tabs of the project top bar. */
export function ProjectNav({ active, needsYou, runsHref = '/runs', deskHref = '/desk' }: ProjectNavProps) {
  return (
    <nav className={styles.tabs} aria-label="Project">
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
      <AppLink
        href={deskHref}
        className={active === 'desk' ? styles.on : undefined}
        aria-current={active === 'desk' ? 'page' : undefined}
      >
        <Icon name="desk" size={15} />
        Desk
      </AppLink>
    </nav>
  );
}

/** Project switch plus tabs on a bare top-bar strip (no brand, no right-hand actions). */
export function ProjectStrip({ org, project, active, needsYou }: ProjectNavProps & { org: string; project: string }) {
  return (
    <div className={`${styles.top} ${styles.stripBare}`}>
      <ProjectSwitch org={org} project={project} />
      <ProjectNav active={active} needsYou={needsYou} />
    </div>
  );
}
