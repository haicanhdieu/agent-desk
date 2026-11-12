import { CountBadge, Icon } from '@/ds';
import { ProjectSwitch } from './ProjectSwitch';
import styles from './Chrome.module.css';

export interface ProjectNavProps {
  active?: 'runs' | 'desk';
  needsYou?: number;
}

/** Runs / Desk tabs of the project top bar. */
export function ProjectNav({ active, needsYou }: ProjectNavProps) {
  return (
    <nav className={styles.tabs} aria-label="Project">
      <a href="/runs" className={active === 'runs' ? styles.on : undefined} aria-current={active === 'runs' ? 'page' : undefined}>
        <Icon name="runs" size={15} />
        Runs
        <CountBadge count={needsYou} label="needs you" title={needsYou ? `${needsYou} ${needsYou === 1 ? 'run needs' : 'runs need'} you` : undefined} />
      </a>
      <a href="/desk" className={active === 'desk' ? styles.on : undefined} aria-current={active === 'desk' ? 'page' : undefined}>
        <Icon name="desk" size={15} />
        Desk
      </a>
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
