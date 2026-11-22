import type { ReactNode } from 'react';
import { Button, IconButton } from '@/ds';
import type { Actor } from '@/mocks/types';
import { AccountMenu, type AccountMenuAccount } from './AccountMenu';
import { Brand } from './Brand';
import { OrgSwitch, type OrgSwitchProps } from './OrgSwitch';
import { OrgNav } from './OrgNav';
import { ProjectSwitch, type ProjectSwitchMenu } from './ProjectSwitch';
import { Breadcrumb, type BreadcrumbItem } from './Breadcrumb';
import { ProjectNav } from './ProjectNav';
import styles from './Chrome.module.css';

export interface TopBarProps {
  /** global = org level; project; run. */
  variant: 'global' | 'project' | 'run';
  user: Actor;
  /** Name, handle and the My invitations link for the account menu. */
  account?: AccountMenuAccount;
  /** The org crumb, on every level. */
  org?: OrgSwitchProps;
  /** Which tabs the bar shows. Default: 'project' on the project variant, else 'none'. */
  tabs?: 'org' | 'project' | 'none';
  active?: 'projects' | 'settings' | 'runs' | 'desk';
  /** `org` is legacy (the org text before the org crumb existed), removed by Task 26. */
  project?: { name: string; repoUrl: string; org?: string };
  /** The project menu behind the switcher button; without it the button does nothing. */
  projectMenu?: ProjectSwitchMenu;
  needsYou?: number;
  /** Run level: the "Runs" link and the current "Run N" crumb. */
  run?: { runsHref: string; label: string };
  /** Legacy, removed by Task 26. */
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
  account,
  org,
  tabs,
  active,
  project,
  projectMenu,
  needsYou,
  run,
  breadcrumb,
  children,
  actions,
  links,
}: TopBarProps) {
  const projectsHref = links?.projects ?? '/projects';
  const avatar = <AccountMenu user={user} account={account} />;
  const bell = <IconButton icon="bell" aria-label="Notifications on" />;
  const shownTabs = tabs ?? (variant === 'project' ? 'project' : 'none');
  const orgCrumb = org && <OrgSwitch {...org} />;
  const projectCrumb = project && <ProjectSwitch project={project.name} menu={projectMenu} />;

  if (variant === 'run') {
    const items: BreadcrumbItem[] = [...(breadcrumb ?? [])];
    if (run) {
      if (orgCrumb) items.push({ control: orgCrumb });
      if (projectCrumb) items.push({ control: projectCrumb });
      items.push({ label: 'Runs', href: run.runsHref }, { label: run.label });
    }
    return (
      <header className={styles.top}>
        <Brand withName={false} href={projectsHref} />
        <span className={styles.sep} />
        {items.length > 0 && <Breadcrumb items={items} />}
        {children && <div className={styles.runExtra}>{children}</div>}
        <span className={styles.grow} />
        {actions}
        {avatar}
      </header>
    );
  }

  const nav =
    shownTabs === 'org' ? (
      <OrgNav
        active={active === 'projects' || active === 'settings' ? active : undefined}
        projectsHref={projectsHref}
        settingsHref={org?.settingsHref}
      />
    ) : shownTabs === 'project' ? (
      <ProjectNav
        active={active === 'desk' ? 'desk' : 'runs'}
        needsYou={needsYou}
        runsHref={links?.runs}
        deskHref={links?.desk}
      />
    ) : null;

  if (variant === 'global') {
    return (
      <header className={styles.top}>
        <Brand href={projectsHref} />
        {orgCrumb && (
          <>
            <span className={styles.sep} />
            {orgCrumb}
          </>
        )}
        {nav}
        <span className={styles.grow} />
        {bell}
        {avatar}
      </header>
    );
  }

  const legacyOrg = project?.org && <span className={styles.crumbText}>{project.org}</span>;
  return (
    <header className={styles.top}>
      <Brand href={projectsHref} />
      <span className={styles.sep} />
      {orgCrumb ?? legacyOrg}
      {project && (orgCrumb || legacyOrg) && (
        <span className={styles.crumbText} aria-hidden="true">
          /
        </span>
      )}
      {projectCrumb}
      {nav}
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
