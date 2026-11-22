import type { ReactNode } from 'react';
import { Button, IconButton } from '@/ds';
import type { Actor } from '@/mocks/types';
import { AccountMenu } from './AccountMenu';
import { Brand } from './Brand';
import { OrgSwitch, orgSwitchVisible, type OrgSwitchProps } from './OrgSwitch';
import { ProjectSwitch, type ProjectSwitchMenu } from './ProjectSwitch';
import { Breadcrumb } from './Breadcrumb';
import { ProjectNav } from './ProjectNav';
import styles from './Chrome.module.css';

export interface TopBarProps {
  variant: 'global' | 'project' | 'run';
  user: Actor;
  project?: { org: string; name: string; repoUrl: string };
  /** The project menu behind the switcher button; without it the button does nothing. */
  projectMenu?: ProjectSwitchMenu;
  /** The org switcher, after the brand on the global variant only. */
  org?: OrgSwitchProps;
  active?: 'runs' | 'desk';
  needsYou?: number;
  breadcrumb?: { label: ReactNode; href?: string }[];
  children?: ReactNode;
  actions?: ReactNode;
  /** In-app hrefs; default to the prototype's "/projects" and "/runs". The Desk tab shows only with `desk`. */
  links?: { projects?: string; runs?: string; desk?: string };
}

/** The 1px divider between top bar groups. */
export function TopBarSeparator() {
  return <span className={styles.sep} aria-hidden="true" />;
}

export function TopBar({
  variant,
  user,
  project,
  projectMenu,
  org,
  active,
  needsYou,
  breadcrumb,
  children,
  actions,
  links,
}: TopBarProps) {
  const projectsHref = links?.projects ?? '/projects';
  const avatar = <AccountMenu user={user} />;
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
        {org && orgSwitchVisible(org) && (
          <>
            <span className={styles.sep} />
            <OrgSwitch {...org} />
          </>
        )}
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
      {project && <ProjectSwitch org={project.org} project={project.name} menu={projectMenu} />}
      <ProjectNav active={active} needsYou={needsYou} runsHref={links?.runs} deskHref={links?.desk} />
      <span className={styles.grow} />
      {project && (
        <Button
          variant="ghost"
          size="sm"
          href={project.repoUrl}
          icon="external"
          target="_blank"
          rel="noopener noreferrer"
        >
          Repo on GitHub
        </Button>
      )}
      {bell}
      {avatar}
    </header>
  );
}
