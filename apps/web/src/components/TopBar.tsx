import type { ReactNode } from 'react';
import { Button, IconButton } from '@/ds';
import type { Actor } from '@/mocks/types';
import { AccountMenu } from './AccountMenu';
import { Brand } from './Brand';
import { OrgSwitch, type OrgSwitchProps } from './OrgSwitch';
import { OrgNav } from './OrgNav';
import { ProjectSwitch, type ProjectSwitchMenu } from './ProjectSwitch';
import { Breadcrumb, type BreadcrumbItem } from './Breadcrumb';
import { PlatformNav, type PlatformNavProps } from './PlatformNav';
import { ProjectNav } from './ProjectNav';
import { pageTitle, type PageCrumb, type PageState } from './pageTitle';
import { useDocumentTitle } from './useDocumentTitle';
import styles from './Chrome.module.css';

export interface TopBarProps {
  /** global = org level; project; run; platform. */
  variant: 'global' | 'project' | 'run' | 'platform';
  user: Actor;
  /** Page crumbs after the scope and project crumbs; NO_PAGE_CRUMBS when the page has none. */
  crumbs: readonly PageCrumb[];
  /** Fixed titles for not-found and forbidden pages. */
  state?: PageState;
  /** The org crumb, on every level. */
  org?: OrgSwitchProps;
  /** Which tabs the bar shows. Default: 'project' on the project variant, else 'none'. */
  tabs?: 'org' | 'project' | 'none';
  active?: 'projects' | 'settings' | 'runs' | 'desk';
  /** The project crumb and, on the project bar, the repository link (absent: no link, as on the run bar). */
  project?: { name: string; repoUrl?: string };
  /** The project menu behind the switcher button; without it the button does nothing. */
  projectMenu?: ProjectSwitchMenu;
  /** The Platform sections tabs, drawn on the platform variant. */
  platformTabs?: PlatformNavProps;
  needsYou?: number;
  children?: ReactNode;
  actions?: ReactNode;
  /** In-app hrefs; `projects` defaults to the org crumb's `projectsHref`, then "/projects"; "/runs" for Runs. The Settings tab shows only with `desk`. */
  links?: { projects?: string; runs?: string; desk?: string };
}

function toItem(c: PageCrumb): BreadcrumbItem {
  if (c.loading) return { loading: `Loading ${c.what ?? 'page'}` };
  return c.href ? { label: c.label, href: c.href } : { label: c.label };
}

/** The 1px divider between top bar groups. */
export function TopBarSeparator() {
  return <span className={styles.sep} aria-hidden="true" />;
}

export function TopBar({
  variant,
  user,
  crumbs,
  state,
  org,
  tabs,
  active,
  project,
  projectMenu,
  platformTabs,
  needsYou,
  children,
  actions,
  links,
}: TopBarProps) {
  const projectsHref = links?.projects ?? org?.projectsHref ?? '/projects';
  const avatar = <AccountMenu user={user} />;
  const bell = <IconButton icon="bell" aria-label="Notifications on" />;
  const shownTabs = tabs ?? (variant === 'project' ? 'project' : 'none');
  const orgCrumb = org && <OrgSwitch {...org} />;
  const projectCrumb = project && <ProjectSwitch project={project.name} menu={projectMenu} />;

  const items: BreadcrumbItem[] = [];
  if (orgCrumb) items.push({ control: orgCrumb });
  if (projectCrumb) items.push({ control: projectCrumb });
  items.push(...crumbs.map(toItem));
  const scope = variant === 'platform' ? 'Platform' : variant === 'global' ? org?.current?.name : project?.name;
  useDocumentTitle(pageTitle({ crumbs, scope, state }));
  const breadcrumb = items.length > 0 && <Breadcrumb items={items} />;

  if (variant === 'run') {
    return (
      <header className={styles.top}>
        <Brand withName={false} href={projectsHref} />
        <span className={styles.sep} />
        {breadcrumb}
        {children && <div className={styles.runExtra}>{children}</div>}
        <span className={styles.grow} />
        {bell}
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

  if (variant === 'platform') {
    return (
      <header className={styles.top}>
        <Brand href={projectsHref} />
        {breadcrumb && (
          <>
            <span className={styles.sep} />
            {breadcrumb}
          </>
        )}
        {platformTabs && <PlatformNav {...platformTabs} />}
        <span className={styles.grow} />
        {bell}
        {avatar}
      </header>
    );
  }

  if (variant === 'global') {
    return (
      <header className={styles.top}>
        <Brand href={projectsHref} />
        {breadcrumb && (
          <>
            <span className={styles.sep} />
            {breadcrumb}
          </>
        )}
        {nav}
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
      {breadcrumb}
      {nav}
      <span className={styles.grow} />
      {project?.repoUrl && (
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
