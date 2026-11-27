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

/**
 * The browser home of a repository from its provider's clone URL (`…/owner/name.git`). No credential may survive:
 * the token is mounted into the run pod, never part of a URL shown to a person. Null when the URL is not a safe https URL.
 */
export function browserRepoUrl(cloneUrl: string): string | null {
  try {
    const url = new URL(cloneUrl);
    if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') return null;
    const path = url.pathname.replace(/\/+$/, '').replace(/\.git$/, '');
    if (path === '' || path === '/') return null;
    url.pathname = path;
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}
