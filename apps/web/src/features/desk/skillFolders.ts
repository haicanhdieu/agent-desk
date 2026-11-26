import { useQuery } from '@tanstack/react-query';
import { skillFolders, type AgentDto } from '@agentdesk/contracts';
import { useDeskRights } from './frame';
import { deskQueries } from './queries';

/**
 * The repo folders the API searches for skills: those of the project's default agent. Without the agent list (not
 * loaded yet, or no `agent:read`) it is Claude Code's, the kind a project starts with.
 */
export function skillFoldersOf(agents: AgentDto[]): string[] {
  return skillFolders(agents.find((a) => a.isDefault)?.provider ?? 'claude');
}

/** `skillFoldersOf` for a page that does not already load the agent list. */
export function useSkillFolders(org: string, projectId: string): string[] {
  const rights = useDeskRights(org, projectId);
  const agents = useQuery({ ...deskQueries.allAgents(org, projectId), enabled: rights.agent });
  return skillFoldersOf(agents.data?.items ?? []);
}
