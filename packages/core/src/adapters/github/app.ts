import { createAppAuth } from '@octokit/auth-app';
import { Octokit } from '@octokit/rest';

export interface GithubClientOptions {
  appId: string;
  privateKey: string;
  /** Injected for tests; defaults to the global fetch. */
  fetch?: typeof fetch;
}

/** Builds Octokit clients authenticated as the app (JWT) or as one installation (cached, auto-refreshed token). */
export class GithubClients {
  private readonly installations = new Map<string, Octokit>();

  constructor(private readonly opts: GithubClientOptions) {}

  private make(installationId?: string): Octokit {
    const { appId, privateKey, fetch: fetchFn } = this.opts;
    return new Octokit({
      authStrategy: createAppAuth,
      auth: { appId, privateKey, ...(installationId ? { installationId: Number(installationId) } : {}) },
      ...(fetchFn ? { request: { fetch: fetchFn } } : {}),
    });
  }

  /** App-level client: only `/app/*` routes (JWT). */
  app(): Octokit {
    return this.make();
  }

  /** Client acting as a user (their linked-account OAuth token). */
  user(token: string): Octokit {
    const { fetch: fetchFn } = this.opts;
    return new Octokit({ auth: token, ...(fetchFn ? { request: { fetch: fetchFn } } : {}) });
  }

  installation(installationId: string): Octokit {
    let c = this.installations.get(installationId);
    if (!c) {
      c = this.make(installationId);
      this.installations.set(installationId, c);
    }
    return c;
  }
}

export function splitRepoPath(repoPath: string): { owner: string; repo: string } {
  const [owner, repo, ...rest] = repoPath.split('/');
  if (!owner || !repo || rest.length > 0) throw new Error(`invalid repo path "${repoPath}"`);
  return { owner, repo };
}

/** HTTP status of an Octokit error, if it is one. */
export function errorStatus(e: unknown): number | undefined {
  if (typeof e === 'object' && e !== null && 'status' in e && typeof e.status === 'number') return e.status;
  return undefined;
}

export function errorHeaders(e: unknown): Record<string, string> {
  if (typeof e === 'object' && e !== null && 'response' in e) {
    const r = e.response;
    if (typeof r === 'object' && r !== null && 'headers' in r && typeof r.headers === 'object' && r.headers !== null) {
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(r.headers))
        if (typeof v === 'string' || typeof v === 'number') out[k.toLowerCase()] = String(v);
      return out;
    }
  }
  return {};
}
