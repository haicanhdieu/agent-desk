import { useQuery } from '@tanstack/react-query';
import type { ProjectSwitchMenu } from '@/components';
import { projectPaths } from '../desk/frame';
import { toProjectMenuItems } from './map';
import { projectsQueries } from './queries';

/** The top bar's project menu for the project page `currentId`: the org's projects, loading, or an error with retry. */
export function useProjectMenu(org: string, currentId: string): ProjectSwitchMenu {
  const { data, isError, refetch } = useQuery(projectsQueries.list(org));
  if (data) return { status: 'ready', items: toProjectMenuItems(data, currentId, (id) => projectPaths(org, id).runs) };
  if (isError) return { status: 'error', onRetry: () => void refetch() };
  return { status: 'loading' };
}
