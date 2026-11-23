import { ApiError } from '@agentdesk/contracts/client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { EnvKind } from '@agentdesk/contracts';
import type { EnvSaveError } from '@/components';
import { api } from '../api';
import { fieldErrorsFromProblem, GENERIC_FORM_ERROR } from '../desk/problem';
import { envKey, setupQueries, versionsKey } from './queries';

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
        qc.invalidateQueries({ queryKey: versionsKey(org, projectId) }),
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

// Project environment entries (spec: Data on screen, Error handling). One entry per call, no optimistic update: a
// failed save keeps the typed value, and a secret cannot be shown before the server has it.

const TOO_MANY = 'Too many entries';
const TOO_LARGE = 'Too large';
// The API gives every 409 the title "Conflict"; its two limit conflicts are told apart by the start of their detail
// (project-env.service.ts `checkLimits`). Both texts are fixed by the API, never by a caller.
const CAP_DETAIL = 'This project already has the maximum of ';
const SIZE_DETAIL = 'Names and values together cannot exceed ';
const TOO_LARGE_DETAIL =
  'Names and values of this project would pass 256 KiB together. Shorten or remove entries to make room.';
const SERVER_ERROR = 500;
const POINTERS = { '/name': 'name', '/value': 'value' };

/**
 * What a failed write shows (spec Copy): a field error by problem pointer, "gone" for a 404, the cap and size banners
 * for a 409, the problem title and request id for a 5xx, the generic text for anything else. `typedName` composes the
 * "already exists" text of a create (the API's own detail may differ).
 */
export function envSaveError(e: unknown, typedName?: string): EnvSaveError {
  if (!(e instanceof ApiError)) return { banner: { title: GENERIC_FORM_ERROR } };
  if (e.status === 404) return { gone: true };
  if (e.status === 409 && e.detail?.startsWith(CAP_DETAIL) === true) {
    return { banner: { title: TOO_MANY, ...(e.detail !== undefined && { detail: e.detail }) } };
  }
  if (e.status === 409 && e.detail?.startsWith(SIZE_DETAIL) === true)
    return { banner: { title: TOO_LARGE, detail: TOO_LARGE_DETAIL } };
  if (e.status >= SERVER_ERROR) {
    return { banner: { title: e.title, ...(e.requestId !== undefined && { requestId: e.requestId }) } };
  }
  const { fields } = fieldErrorsFromProblem(e, POINTERS);
  const name =
    e.status === 409 && typedName !== undefined && fields.name !== undefined
      ? `${typedName} already exists. A name can be used once, as a variable or a secret.`
      : fields.name;
  if (name === undefined && fields.value === undefined) return { banner: { title: GENERIC_FORM_ERROR } };
  return { field: { ...(name !== undefined && { name }), ...(fields.value !== undefined && { value: fields.value }) } };
}

export interface EnvEntryInput {
  name: string;
  value: string;
}

/**
 * Runs one write of the `kind` and answers what to show: null when it saved, else the error. A success invalidates
 * only this kind's lists; a 404 (removed meanwhile) refetches them too. A secret's variables and response are not
 * kept: the mutation drops the response, is collected at once (`gcTime: 0`) and is reset after it settles.
 */
function useEnvWrite<V>(
  org: string,
  projectId: string,
  kind: EnvKind,
  send: (v: V) => Promise<unknown>,
  nameOf: (v: V) => string | undefined,
) {
  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: async (v: V): Promise<void> => {
      await send(v);
    },
    gcTime: 0,
    onSuccess: () => qc.invalidateQueries({ queryKey: envKey(org, projectId, kind) }),
    onError: (e) => {
      if (e instanceof ApiError && e.status === 404)
        void qc.invalidateQueries({ queryKey: envKey(org, projectId, kind) });
    },
  });
  const save = async (v: V): Promise<EnvSaveError | null> => {
    try {
      await mutation.mutateAsync(v);
      return null;
    } catch (e) {
      return envSaveError(e, nameOf(v));
    } finally {
      if (kind === 'secret') mutation.reset();
    }
  };
  return { save, pending: mutation.isPending };
}

/** Adds an entry (POST: 409 when the name exists in either kind). */
export function useCreateEnvEntry(org: string, projectId: string, kind: EnvKind) {
  return useEnvWrite<EnvEntryInput>(
    org,
    projectId,
    kind,
    (body) =>
      kind === 'plain'
        ? api.projectEnv.createVar({ params: { projectId }, body })
        : api.projectEnv.createSecret({ params: { projectId }, body }),
    (v) => v.name,
  );
}

/** Edits or replaces an entry (PUT: 404 when it is gone; never creates). */
export function useUpdateEnvEntry(org: string, projectId: string, kind: EnvKind) {
  return useEnvWrite<EnvEntryInput>(
    org,
    projectId,
    kind,
    ({ name, value }) =>
      kind === 'plain'
        ? api.projectEnv.updateVar({ params: { projectId, name }, body: { value } })
        : api.projectEnv.updateSecret({ params: { projectId, name }, body: { value } }),
    () => undefined,
  );
}

/** Removes an entry by name (DELETE: 404 when it is gone). */
export function useRemoveEnvEntry(org: string, projectId: string, kind: EnvKind) {
  return useEnvWrite<string>(
    org,
    projectId,
    kind,
    (name) =>
      kind === 'plain'
        ? api.projectEnv.removeVar({ params: { projectId, name } })
        : api.projectEnv.removeSecret({ params: { projectId, name } }),
    () => undefined,
  );
}
