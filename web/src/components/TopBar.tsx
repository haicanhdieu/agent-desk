import type { ReactNode } from 'react';
import { Avatar, Button, CountBadge, Icon, IconButton } from '@/ds';
import type { Actor } from '@/mocks/types';
import { Brand } from './Brand';
import { Breadcrumb } from './Breadcrumb';
import { ProjectSwitch } from './ProjectSwitch';
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
}

export function TopBar({ variant, user, project, active, needsYou, breadcrumb, children, actions }: TopBarProps) {
  const avatar = <Avatar initials={user.initials} kind={user.bot ? 'bot' : 'user'} title={user.login} />;
  const bell = <IconButton icon="bell" aria-label="Notifications on" />;

  if (variant === 'run') {
    return (
      <header className={styles.top}>
        <Brand withName={false} href="/projects" />
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
        <Brand href="/projects" />
        <span className={styles.grow} />
        {bell}
        {avatar}
      </header>
    );
  }

  return (
    <header className={styles.top}>
      <Brand href="/projects" />
      <span className={styles.sep} />
      {project && <ProjectSwitch org={project.org} project={project.name} />}
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
      <span className={styles.grow} />
      {project && <Button variant="ghost" size="sm" href={project.repoUrl} icon="external">Repo on GitHub</Button>}
      {bell}
      {avatar}
    </header>
  );
}
