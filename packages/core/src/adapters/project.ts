import type { AdapterProject } from './types';

/** The project columns adapters need (`projects.default_branch` is null for projects created before it existed). */
export interface AdapterProjectRow {
  repoPath: string;
  defaultBranch: string | null;
}

/**
 * The one mapping from a project row and its connection's external id to an AdapterProject. Every caller builds the
 * adapter's view through here, so a new project field reaches every adapter call at once.
 */
export function toAdapterProject(row: AdapterProjectRow, connectionExternalId: string): AdapterProject {
  return {
    repoPath: row.repoPath,
    connectionExternalId,
    ...(row.defaultBranch !== null ? { defaultBranch: row.defaultBranch } : {}),
  };
}
