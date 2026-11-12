import type { ReactNode } from 'react';
import { Avatar, Button, IconButton } from '@/ds';
import type { Actor } from '@/mocks/types';
import { Brand } from './Brand';
import { ProjectSwitch } from './ProjectSwitch';
import { Breadcrumb } from './Breadcrumb';
import { ProjectNav } from './ProjectNav';
import styles from './Chrome.module.css';

export interface TopBarProps {
  variant: 'global' | 'project' | 'run';
  user: Actor;
  project?: { org: string; name: string; repoUrl: string };
  active?: 'runs' | 'desk';
  needsYou?: number;
  breadcrumb?: { label: ReactNode; href?: string }[];
  children?: ReactNode;
  actions?: ReactNode;
  /** In-app hrefs; default to the prototype's "/projects", "/runs" and "/desk". */
  links?: { projects?: string; runs?: string; desk?: string };
}

/** The 1px divider between top bar groups. */
export function TopBarSeparator() {
  return <span className={styles.sep} aria-hidden="true" />;
}

export function TopBar({ variant, user, project, active, needsYou, breadcrumb, children, actions, links }: TopBarProps) {
  const projectsHref = links?.projects ?? '/projects';
  const avatar = <Avatar initials={user.initials} kind={user.bot ? 'bot' : 'user'} title={user.login} />;
  const bell = <IconButton icon="bell" aria-label="Notifications on" />;

  if (variant === 'run') {
    return (
      <header className={styles.top}>
        <Brand withName={false} href={projectsHref} />
        <span className={styles.sep} />
        {breadcrumb && <Breadcrumb items={breadcrumb} />}
        {children && <div className={styles.runExtra}>{children}</div>}
        <span className={styles.grow} />
        {actions}
        {avatar}
      </header>
    );
  }

  if (variant === 'global') {
    return (
      <header className={styles.top}>
        <Brand href={projectsHref} />
        <span className={styles.grow} />
        {bell}
        {avatar}
      </header>
    );
  }

  return (
    <header className={styles.top}>
      <Brand href={projectsHref} />
      <span className={styles.sep} />
      {project && <ProjectSwitch org={project.org} project={project.name} />}
      <ProjectNav active={active} needsYou={needsYou} runsHref={links?.runs} deskHref={links?.desk} />
      <span className={styles.grow} />
      {project && <Button variant="ghost" size="sm" href={project.repoUrl} icon="external">Repo on GitHub</Button>}
      {bell}
      {avatar}
    </header>
  );
}
