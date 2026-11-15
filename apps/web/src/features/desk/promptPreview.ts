import { useQuery } from '@tanstack/react-query';
import type { PromptPreview } from '@/components/PromptSystemPart';
import { deskQueries } from './queries';

/** The server's system lines for the rule form's read-only part, in the shape `PromptSystemPart` takes. */
export function usePromptPreview(org: string, projectId: string, enabled: boolean): PromptPreview {
  const query = useQuery({ ...deskQueries.promptPreview(org, projectId), enabled });
  if (query.data) return { state: 'ready', systemLines: query.data.systemLines };
  if (query.isError) return { state: 'error', onRetry: () => void query.refetch() };
  return { state: 'loading' };
}
