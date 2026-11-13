import { useSuspenseQuery } from '@tanstack/react-query';
import type { Actor } from '@/mocks/types';
import type { DeskFrameData } from '@/screens';
import { sessionQuery } from '../auth/session';
import { toConnectionStatus, toProject } from '../projects/map';
import { projectsQueries } from '../projects/queries';

/** In-app paths of a project, for the screens' links. */
export function projectPaths(org: string, projectId: string) {
  const orgPath = `/o/${encodeURIComponent(org)}`;
  const projectPath = `${orgPath}/p/${encodeURIComponent(projectId)}`;
  return {
    projects: `${orgPath}/projects`,
    runs: `${projectPath}/runs`,
    needsYou: `${projectPath}/needs-you`,
    skills: `${projectPath}/desk/skills`,
    rules: `${projectPath}/desk/rules`,
    agent: `${projectPath}/desk/agent`,
    setup: `${projectPath}/desk/setup`,
  };
}

/** Top bar and Desk navigation data for a project page, from the `$project` layout's cached queries. Pass `useNow()`. */
export function useDeskFrame(org: string, projectId: string, now: Date): DeskFrameData {
  const { data: session } = useSuspenseQuery(sessionQuery);
  const { data: dto } = useSuspenseQuery(projectsQueries.detail(org, projectId));
  const { data: connectionDto } = useSuspenseQuery(projectsQueries.connection(org, projectId));
  const connection = toConnectionStatus(connectionDto, dto, now);
  const project = toProject(dto, connection, org, now);
  // The top bar and Desk show the repository owner where the prototype shows "org".
  const owner = dto.repoPath.split('/')[0] ?? '';
  const handle = session?.user.handle ?? '';
  const user: Actor = { login: handle, initials: handle.slice(0, 2).toUpperCase() };
  const paths = projectPaths(org, projectId);
  return {
    user,
    project: { org: owner, name: project.name, repo: project.repo, needsYou: project.needsYou },
    connection,
    links: {
      projects: paths.projects,
      runs: paths.runs,
      desk: paths.skills,
      skills: paths.skills,
      rules: paths.rules,
      agent: paths.agent,
    },
  };
}
