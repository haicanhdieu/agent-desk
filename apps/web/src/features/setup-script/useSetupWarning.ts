import { useQuery } from '@tanstack/react-query';
import { setupWarningOf, type SetupWarning } from './map';
import { setupQueries } from './queries';

/**
 * The project's setup warning, or undefined while loading, on a load error (a warning never blocks anything) and
 * when there is nothing to warn about.
 */
export function useSetupWarning(org: string, projectId: string): SetupWarning | undefined {
  const script = useQuery(setupQueries.script(org, projectId));
  const latest = useQuery(setupQueries.latest(org, projectId));
  if (!script.isSuccess || !latest.isSuccess) return undefined;
  return setupWarningOf(script.data, latest.data);
}
