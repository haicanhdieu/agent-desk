import { useSuspenseQuery } from '@tanstack/react-query';
import { can } from '@agentdesk/contracts';
import type { AccountMenuAccount, OrgSwitchProps } from '@/components';
import type { DeskFrameData } from '@/screens';
import { useAccess } from '../access/guards';
import { useAppBar } from '../chrome/appBar';
import { toConnectionStatus, toProject } from '../projects/map';
import { useProjectMenu } from '../projects/menu';
import { projectsQueries } from '../projects/queries';
import { useSetupWarning } from '../setup-script/useSetupWarning';

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

/** Which Desk pages the caller may open on a project. Everything is false while the grants load or when they failed. */
export interface DeskRights {
  rules: boolean;
  skills: boolean;
  agent: boolean;
  setup: boolean;
}

/** The Desk pages the caller may open on `projectId` (issue 216: not a member or a viewer). */
export function useDeskRights(org: string, projectId: string): DeskRights {
  const access = useAccess(org);
  const target = { projectId };
  return {
    rules: access !== undefined && can(access, 'rule:read', target),
    skills: access !== undefined && can(access, 'skill:read', target),
    agent: access !== undefined && can(access, 'agent:read', target),
    setup: access !== undefined && can(access, 'setup:read', target),
  };
}

/** Top bar and Desk navigation data for a project page, from the `$project` layout's cached queries. Pass `useNow()`. */
export function useDeskFrame(
  org: string,
  projectId: string,
  now: Date,
): DeskFrameData & { org: OrgSwitchProps; account: AccountMenuAccount } {
  const bar = useAppBar(org);
  const { data: dto } = useSuspenseQuery(projectsQueries.detail(org, projectId));
  const { data: connectionDto } = useSuspenseQuery(projectsQueries.connection(org, projectId));
  const connection = toConnectionStatus(connectionDto, dto, now);
  const project = toProject(dto, connection, org, now);
  // The Desk repository line shows the repository owner where the prototype shows "org".
  const owner = dto.repoPath.split('/')[0] ?? '';
  const paths = projectPaths(org, projectId);
  const rights = useDeskRights(org, projectId);
  const warning = useSetupWarning(org, projectId, rights.setup);
  const projectMenu = useProjectMenu(org, projectId);
  return {
    user: bar.user,
    project: { org: owner, name: project.name, repo: project.repo, needsYou: project.needsYou },
    connection,
    projectMenu,
    org: bar.org,
    account: bar.account,
    links: {
      projects: paths.projects,
      runs: paths.runs,
      // The Desk tab opens the rules page, so it shows only for roles that may read it.
      ...(rights.rules && { desk: paths.rules }),
      skills: paths.skills,
      rules: paths.rules,
      agent: paths.agent,
      setup: paths.setup,
    },
    ...(warning && rights.setup && { warning: { title: warning.title, detail: warning.detail, href: paths.setup } }),
  };
}
