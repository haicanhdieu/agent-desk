import { useSuspenseQuery } from '@tanstack/react-query';
import { can, type Access, type Permission } from '@agentdesk/contracts';
import type { DeskFrameData } from '@/screens';
import { useAccess } from '../access/guards';
import { orgsQuery } from '../auth/session';
import { toConnectionStatus, toProject } from '../projects/map';
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

/** The project, its connection and the setup warning for a Desk page, from the `$project` layout's cached queries. Pass `useNow()`. */
export function useDeskFrame(org: string, projectId: string, now: Date): DeskFrameData & { orgName: string } {
  const { data: orgs } = useSuspenseQuery(orgsQuery);
  const { data: dto } = useSuspenseQuery(projectsQueries.detail(org, projectId));
  const { data: connectionDto } = useSuspenseQuery(projectsQueries.connection(org, projectId));
  const connection = toConnectionStatus(connectionDto, dto, now);
  const project = toProject(dto, connection, org, now);
  // The Desk repository line shows the repository owner where the prototype shows "org".
  const owner = dto.repoPath.split('/')[0] ?? '';
  const paths = projectPaths(org, projectId);
  const rights = useDeskRights(org, projectId);
  const warning = useSetupWarning(org, projectId, rights.setup);
  return {
    project: { org: owner, name: project.name, repo: project.repo, needsYou: project.needsYou },
    connection,
    orgName: orgs.find((o) => o.slug === org)?.name ?? org,
    ...(warning && rights.setup && { warning: { title: warning.title, detail: warning.detail, href: paths.setup } }),
  };
}
