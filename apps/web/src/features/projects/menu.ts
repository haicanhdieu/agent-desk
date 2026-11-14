import { useCallback, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ProjectSwitchMenu } from '@/components';
import { projectPaths } from '../desk/frame';
import { toProjectMenuItems } from './map';
import { projectsQueries } from './queries';

/**
 * The top bar's project menu for the project page `currentId`: the org's projects, loading, or an error with retry.
 * The list is fetched once the menu is first opened (`onOpen`), not on page load.
 */
export function useProjectMenu(org: string, currentId: string): ProjectSwitchMenu {
  const [opened, setOpened] = useState(false);
  const { data, isError, refetch } = useQuery({ ...projectsQueries.list(org), enabled: opened });
  const onOpen = useCallback(() => setOpened(true), []);
  if (data) {
    return { status: 'ready', items: toProjectMenuItems(data, currentId, (id) => projectPaths(org, id).runs), onOpen };
  }
  if (isError) return { status: 'error', onRetry: () => void refetch(), onOpen };
  return { status: 'loading', onOpen };
}
