import { ApiError } from '@agentdesk/contracts/client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { setupQueries } from './queries';

// Setup script saves and test workspaces (spec §5.5). No optimistic updates: the cache takes what the server answers.

export const STALE_SETUP_SCRIPT = 'Changed since you opened it. Reload to see the new version.';

/** A 409 on a save: the version the draft started from is no longer the current one. */
export const isStaleSetupScript = (e: unknown): boolean => e instanceof ApiError && e.status === 409;

export interface SaveSetupScriptInput {
  body: string;
  note?: string;
  /** The version the draft started from (null when there was none); the server refuses the save when it moved on. */
  baseVersion: number | null;
}

/** Saves a new version. On success the script is cached, history and the last test (does it still match?) refetch. */
export function useSaveSetupScript(org: string, projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ body, note, baseVersion }: SaveSetupScriptInput) =>
      api.setupScript.put({
        params: { projectId },
        body: { body, baseVersion, ...(note !== undefined && note !== '' && { note }) },
      }),
    onSuccess: async (saved) => {
      qc.setQueryData(setupQueries.script(org, projectId).queryKey, saved);
      await Promise.all([
        qc.invalidateQueries({ queryKey: setupQueries.versions(org, projectId).queryKey }),
        qc.invalidateQueries({ queryKey: setupQueries.latest(org, projectId).queryKey }),
      ]);
    },
  });
}

/** Starts a test workspace with the editor's text; the created test is the latest one at once. */
export function useCreateSetupTest(org: string, projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (script: string) => api.setupTests.create({ params: { projectId }, body: { script } }),
    onSuccess: (test) => qc.setQueryData(setupQueries.latest(org, projectId).queryKey, test),
  });
}

/** Ends the test workspace; the latest test refetches (ended). */
export function useEndSetupTest(org: string, projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (setupTestId: string) => api.setupTests.end({ params: { setupTestId } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: setupQueries.latest(org, projectId).queryKey }),
  });
}
