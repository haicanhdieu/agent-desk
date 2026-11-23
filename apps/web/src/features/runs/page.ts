import { useSuspenseQuery } from '@tanstack/react-query';
import type { ProjectConnectionDto, ProjectDto } from '@agentdesk/contracts';
import type { Actor, ConnectionStatus, Project } from '@/mocks/types';
import type { OrgSwitchProps, ProjectSwitchMenu, TopBarProps } from '@/components';
import { projectPaths, useDeskFrame, useDeskRights, type DeskRights } from '../desk/frame';
import { toConnectionStatus, toProject } from '../projects/map';
import { projectsQueries } from '../projects/queries';

export interface ProjectPage {
  dto: ProjectDto;
  connectionDto: ProjectConnectionDto;
  connection: ConnectionStatus;
  /** The screens' project; `org` is the repository owner, as in the top bar on the boards and the Desk. */
  project: Project;
  user: Actor;
  paths: ReturnType<typeof projectPaths>;
  links: NonNullable<TopBarProps['links']>;
  projectMenu: ProjectSwitchMenu;
  /** The org crumb and account menu of the app bar (Settings only for roles that may open it). */
  org: OrgSwitchProps;
  /** The Desk pages the caller may open here; links to the others are left out (issue 216). */
  desk: DeskRights;
}

/** Project, connection, user and links for the Runs and Needs-you pages, from the `$project` layout's cache. */
export function useProjectPage(org: string, projectId: string, now: Date): ProjectPage {
  const frame = useDeskFrame(org, projectId, now);
  const desk = useDeskRights(org, projectId);
  const { data: dto } = useSuspenseQuery(projectsQueries.detail(org, projectId));
  const { data: connectionDto } = useSuspenseQuery(projectsQueries.connection(org, projectId));
  const connection = toConnectionStatus(connectionDto, dto, now);
  const paths = projectPaths(org, projectId);
  return {
    dto,
    connectionDto,
    connection,
    project: { ...toProject(dto, connection, org, now), org: frame.project.org },
    user: frame.user,
    paths,
    links: { projects: paths.projects, runs: paths.runs, ...(frame.links?.desk && { desk: frame.links.desk }) },
    projectMenu: frame.projectMenu ?? { status: 'loading' },
    org: frame.org,
    desk,
  };
}

/** In-app href of a run. */
export const runHref = (paths: ReturnType<typeof projectPaths>, number: number): string => `${paths.runs}/${number}`;
