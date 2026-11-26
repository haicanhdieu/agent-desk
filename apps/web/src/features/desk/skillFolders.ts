import { useQuery } from '@tanstack/react-query';
import { skillFolders, type AgentDto } from '@agentdesk/contracts';
import { useDeskRights } from './frame';
import { deskQueries } from './queries';

/**
 * The repo folders the API searches for skills: those of the project's default agent. Undefined until the agent list
 * has loaded (or when it cannot be read), so the page names no folder it may have to take back.
 */
export function skillFoldersOf(agents: AgentDto[] | undefined): string[] | undefined {
  if (agents === undefined) return undefined;
  return skillFolders(agents.find((a) => a.isDefault)?.provider ?? 'claude');
}

/** `skillFoldersOf` for a page that does not already load the agent list. */
export function useSkillFolders(org: string, projectId: string): string[] | undefined {
  const rights = useDeskRights(org, projectId);
  const agents = useQuery({ ...deskQueries.allAgents(org, projectId), enabled: rights.agent });
  return skillFoldersOf(agents.data?.items);
}
