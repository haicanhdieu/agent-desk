import { useSuspenseQuery } from '@tanstack/react-query';
import type { ProjectConnectionDto, ProjectDto } from '@agentdesk/contracts';
import type { ConnectionStatus, Project } from '@/mocks/types';
import { projectPaths, useDeskFrame, useDeskRights, type DeskRights } from '../desk/frame';
import { toConnectionStatus, toProject } from '../projects/map';
import { projectsQueries } from '../projects/queries';

export interface ProjectPage {
  dto: ProjectDto;
  connectionDto: ProjectConnectionDto;
  connection: ConnectionStatus;
  /** The screens' project; `org` is the repository owner, as on the boards and the Desk. */
  project: Project;
  paths: ReturnType<typeof projectPaths>;
  /** The Desk pages the caller may open here; links to the others are left out (issue 216). */
  desk: DeskRights;
}

/** Project, connection and links for the Runs and run pages, from the `$project` layout's cache. */
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
    paths,
    desk,
  };
}

/** In-app href of a run. */
export const runHref = (paths: ReturnType<typeof projectPaths>, number: number): string => `${paths.runs}/${number}`;
