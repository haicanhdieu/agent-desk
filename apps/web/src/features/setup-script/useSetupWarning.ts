import { useQuery } from '@tanstack/react-query';
import { setupWarningOf, type SetupWarning } from './map';
import { setupQueries } from './queries';

/**
 * The project's setup warning, or undefined while loading, on a load error (a warning never blocks anything) and
 * when there is nothing to warn about. Nothing is requested unless `allowed` (the caller holds `setup:read`): a
 * member or viewer would only get a 403 for it.
 */
export function useSetupWarning(org: string, projectId: string, allowed: boolean): SetupWarning | undefined {
  const script = useQuery({ ...setupQueries.script(org, projectId), enabled: allowed });
  const latest = useQuery({ ...setupQueries.latest(org, projectId), enabled: allowed });
  if (!allowed || !script.isSuccess || !latest.isSuccess) return undefined;
  return setupWarningOf(script.data, latest.data);
}
