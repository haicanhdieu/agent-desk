import { useSuspenseQuery } from '@tanstack/react-query';
import { can, type Access, type Permission } from '@agentdesk/contracts';
import type { OrgSwitchProps } from '@/components';
import type { DeskFrameData, DeskLinks } from '@/screens';
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
    skills: `${projectPath}/desk/skills`,
    rules: `${projectPath}/desk/rules`,
    agent: `${projectPath}/desk/agent`,
    setup: `${projectPath}/desk/setup`,
    members: `${projectPath}/desk/members`,
    audit: `${projectPath}/desk/audit`,
  };
}

/** Which Desk pages the caller may open on a project. Everything is false while the grants load or when they failed. */
export interface DeskRights {
  rules: boolean;
  skills: boolean;
  agent: boolean;
  setup: boolean;
  /** `assignment:read` on the project: the Members page. */
  members: boolean;
  /** `project-audit:read` on the project: the Audit log page. */
  audit: boolean;
}

/** The Desk pages the caller may open on `projectId` (issue 216: not a member or a viewer). */
export function useDeskRights(org: string, projectId: string): DeskRights {
  return deskRightsOf(useAccess(org), projectId);
}

/** The Desk pages `access` opens on `projectId`; everything is false without grants (fail closed). */
export function deskRightsOf(access: Access | undefined, projectId: string): DeskRights {
  const target = { projectId };
  const holds = (permission: Permission) => access !== undefined && can(access, permission, target);
  return {
    rules: holds('rule:read'),
    skills: holds('skill:read'),
    agent: holds('agent:read'),
    setup: holds('setup:read'),
    members: holds('assignment:read'),
    audit: holds('project-audit:read'),
  };
}

/** The Desk menu links the caller may open: each is set only when its right is held. */
export function deskLinksFor(
  paths: ReturnType<typeof projectPaths>,
  rights: DeskRights,
): Pick<DeskLinks, 'skills' | 'rules' | 'agent' | 'setup' | 'members' | 'audit' | 'desk'> {
  return {
    // The Settings tab opens the rules page, so it shows only for roles that may read it.
    ...(rights.rules && { desk: paths.rules, rules: paths.rules }),
    ...(rights.skills && { skills: paths.skills }),
    ...(rights.agent && { agent: paths.agent }),
    ...(rights.setup && { setup: paths.setup }),
    ...(rights.members && { members: paths.members }),
    ...(rights.audit && { audit: paths.audit }),
  };
}

/** Top bar and Desk navigation data for a project page, from the `$project` layout's cached queries. Pass `useNow()`. */
export function useDeskFrame(org: string, projectId: string, now: Date): DeskFrameData & { org: OrgSwitchProps } {
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
    links: {
      projects: paths.projects,
      runs: paths.runs,
      ...deskLinksFor(paths, rights),
    },
    ...(warning && rights.setup && { warning: { title: warning.title, detail: warning.detail, href: paths.setup } }),
  };
}
