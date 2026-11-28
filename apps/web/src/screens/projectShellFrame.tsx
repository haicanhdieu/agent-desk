import type { ReactNode } from 'react';
import { type OrgSwitchProps, type PageCrumb, type ProjectSwitchMenu } from '@/components';
import {
  projectMenuFixtures,
  projectSwitchFixtures,
  projects,
  user,
  withProjectMenuActive,
  type ProjectMenuPage,
} from '@/mocks';
import type { Actor } from '@/mocks/types';
import { harborOrg } from './orgShellFrame';
import { ShellFrame } from './shellFrame';

export interface ProjectShellFrameProps {
  /** Which "Project menu" the shell draws. */
  menu?: keyof typeof projectMenuFixtures;
  /** The menu item marked as the current page; none for a not-found page. */
  page: ProjectMenuPage | null;
  org?: OrgSwitchProps;
  user?: Actor;
  /** What the project switcher's popover holds. */
  switcher?: ProjectSwitchMenu;
  crumbs?: readonly PageCrumb[];
  /** Menu collapsed to its 48px strip. */
  collapsed?: boolean;
  fill?: boolean;
  height?: number;
  children: ReactNode;
}

/**
 * Stories and screen tests only: the shell with the project menu around a project screen, as the route renders it.
 * The screen inside draws only its own page.
 */
export function ProjectShellFrame({
  menu = 'full',
  page,
  org = harborOrg,
  user: actor = user,
  switcher = projectSwitchFixtures.ready,
  crumbs = [],
  collapsed = false,
  fill,
  height = 900,
  children,
}: ProjectShellFrameProps) {
  const fixture = projectMenuFixtures[menu];
  const model = page === null ? fixture : withProjectMenuActive(fixture, page);
  const project = projects[0]!;
  return (
    <ShellFrame
      height={height}
      {...(fill && { fill })}
      menuModel={model}
      collapsed={collapsed}
      topBar={{
        user: actor,
        crumbs,
        org,
        projectName: project.name,
        projectMenu: switcher,
      }}
    >
      {children}
    </ShellFrame>
  );
}
