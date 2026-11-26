import type { RepoDto, SkillDto, SkillSummaryDto } from '@agentdesk/contracts';
import { z } from 'zod';
import type { Clock } from '../../clock';
import {
  SkillBranchExistsError,
  SkillChangeRequestError,
  SkillConflictError,
  SkillNotFoundError,
  skillDescription,
  skillFoldersOf,
  type AdapterConnection,
  type AdapterProject,
  type CheckoutTicket,
  type CodeHostAdapter,
  ProviderReauthRequiredError,
  ProviderUnavailableError,
  RepoFileError,
  type InstallUser,
  type NewConnection,
  type SkillChangeResult,
} from '../types';
import { assertSafeRef, errorHeaders, errorStatus, splitRepoPath, type GithubClients } from './app';

export interface GithubCodeHostOptions {
  appSlug: string;
  botName: string;
  botEmail: string;
}

const SKILL_NAME = /^[a-z0-9-]+$/;
const REPO_FILE_SEGMENT = /^[A-Za-z0-9._-]+$/;
// A login and user id become env values in the run pod, so only what GitHub itself issues may get through.
const GITHUB_LOGIN = /^[A-Za-z0-9][A-Za-z0-9-]*(\[bot\])?$/;
const GITHUB_USER_ID = /^[0-9]+$/;

const TokenResponse = z.object({ token: z.string(), expires_at: z.string() });
const ReposResponse = z.object({
  repositories: z.array(z.object({ full_name: z.string(), private: z.boolean(), default_branch: z.string() })),
});
const DirEntries = z.array(z.object({ name: z.string(), type: z.string() }));
const FileResponse = z.object({ sha: z.string(), content: z.string(), encoding: z.string() });
const CommitList = z.array(
  z.object({
    sha: z.string(),
    commit: z.object({ message: z.string(), committer: z.object({ date: z.string() }).nullable() }),
  }),
);
const WriteResponse = z.object({ commit: z.object({ sha: z.string() }) });
const BranchResponse = z.object({ protected: z.boolean(), commit: z.object({ sha: z.string() }) });
const PullResponse = z.object({ number: z.number(), html_url: z.string() });
const UserInstallations = z.object({
  installations: z.array(
    z.object({
      id: z.number(),
      html_url: z.string().nullish(),
      account: z.object({ login: z.string(), type: z.string(), id: z.number() }).nullish(),
    }),
  ),
});
const GithubUser = z.object({ id: z.number() });
const OrgMemberships = z.array(z.object({ role: z.string(), organization: z.object({ login: z.string() }) }));
const PER_PAGE = 100;
const MAX_PAGES = 5;
const InstallationInfo = z.object({
  id: z.number(),
  html_url: z.string().nullish(),
  account: z.object({ login: z.string() }).nullable(),
});

/** GitHub's own settings page for the installation; anything that is not an https URL is dropped. */
function manageUrlOf(htmlUrl: string | null | undefined): string | null {
  if (!htmlUrl) return null;
  try {
    return new URL(htmlUrl).protocol === 'https:' ? htmlUrl : null;
  } catch {
    return null;
  }
}

function skillPath(folder: string, name: string): string {
  if (!SKILL_NAME.test(name)) throw new Error(`invalid skill name "${name}"`);
  return `${folder}/${name}/SKILL.md`;
}

type GithubInstallationClient = ReturnType<GithubClients['installation']>;

function isPermissionStatus(s: number | undefined): boolean {
  return s === 401 || s === 403;
}

/**
 * What a failed request made with the user's own token means, in provider-neutral terms: a rejected token needs the
 * user to connect again; a rate limit, a server error or a network failure (Octokit reports it as status 500) means
 * try later. Anything else (a plain 403, 404, a parse error) is returned unchanged. Only the status survives.
 */
function userRequestFailure(e: unknown): unknown {
  const status = errorStatus(e);
  if (status === undefined) return e;
  if (status === 401) return new ProviderReauthRequiredError();
  const headers = errorHeaders(e);
  const limited =
    status === 429 ||
    (status === 403 && (headers['x-ratelimit-remaining'] === '0' || headers['retry-after'] !== undefined));
  if (limited) return new ProviderUnavailableError({ rateLimited: true, upstreamStatus: status });
  if (status >= 500) return new ProviderUnavailableError({ rateLimited: false, upstreamStatus: status });
  return e;
}

/** Only GitHub's "reference already exists" is a branch-name collision; any other failure is not a stale edit. */
function refCreateError(e: unknown, name: string): Error {
  const status = errorStatus(e);
  const message = e instanceof Error ? e.message : '';
  if (status === 422 && /already exists/i.test(message)) return new SkillBranchExistsError(name);
  return new SkillChangeRequestError(isPermissionStatus(status) ? 'permission' : 'branch', name);
}

export class GithubCodeHostAdapter implements CodeHostAdapter {
  constructor(
    private readonly clients: GithubClients,
    private readonly clock: Clock,
    private readonly opts: GithubCodeHostOptions,
  ) {}

  installUrl(_orgId: string, state: string): string {
    return `https://github.com/apps/${this.opts.appSlug}/installations/new?state=${encodeURIComponent(state)}`;
  }

  /**
   * The installation must be one the user's own linked account owns (their own account's, or an org they administer),
   * not merely one visible to them, so one user cannot claim another's install.
   */
  async completeInstall(params: Record<string, string>, user: InstallUser): Promise<NewConnection> {
    const installationId = Number(params.installation_id);
    if (!Number.isInteger(installationId) || installationId < 1) throw new Error('missing installation_id');
    if (!user.linkedAccountToken) throw new Error('no linked account for this user');
    // The user's token is only used for this one access check and is never stored or logged.
    const userClient = this.clients.user(user.linkedAccountToken);
    let accessible = false;
    try {
      const isOwned = await this.ownershipTest(userClient);
      for (let page = 1; page <= MAX_PAGES; page++) {
        const res = await userClient.request('GET /user/installations', { per_page: PER_PAGE, page });
        const { installations } = UserInstallations.parse(res.data);
        const found = installations.find((i) => i.id === installationId);
        if (found) {
          accessible = await isOwned(found.account);
          break;
        }
        if (installations.length < PER_PAGE) break;
      }
    } catch (e) {
      throw userRequestFailure(e);
    }
    if (!accessible) throw new Error('installation is not accessible to this user');
    const info = InstallationInfo.parse(
      (
        await this.clients
          .app()
          .request('GET /app/installations/{installation_id}', { installation_id: installationId })
      ).data,
    );
    return {
      provider: 'github',
      externalId: String(info.id),
      accountName: info.account?.login ?? String(info.id),
      capabilities: { code: true, board: true },
      manageUrl: manageUrlOf(info.html_url),
    };
  }

  /**
   * Installs the user may link: their own account's, and those of organizations they administer. A bare
   * `/user/installations` entry (e.g. reachable through one shared repo) is not enough to claim an install. The token is
   * never stored.
   */
  async listInstallations(user: InstallUser): Promise<NewConnection[]> {
    if (!user.linkedAccountToken) return [];
    const client = this.clients.user(user.linkedAccountToken);
    const out: NewConnection[] = [];
    try {
      const isOwned = await this.ownershipTest(client);
      for (let page = 1; page <= MAX_PAGES; page++) {
        const res = await client.request('GET /user/installations', { per_page: PER_PAGE, page });
        const { installations } = UserInstallations.parse(res.data);
        for (const i of installations) {
          if (!(await isOwned(i.account))) continue;
          out.push({
            provider: 'github',
            externalId: String(i.id),
            accountName: i.account?.login ?? String(i.id),
            capabilities: { code: true, board: true },
            manageUrl: manageUrlOf(i.html_url),
          });
        }
        if (installations.length < PER_PAGE) break;
      }
    } catch (e) {
      throw userRequestFailure(e);
    }
    return out;
  }

  /**
   * Whether an installation's account belongs to the user: their own User account, or an Organization they administer.
   * The admin list is fetched once, and only if an org install is checked.
   */
  private async ownershipTest(client: ReturnType<GithubClients['user']>) {
    const me = GithubUser.parse((await client.request('GET /user')).data);
    let adminOrgs: Set<string> | undefined;
    return async (account: z.infer<typeof UserInstallations>['installations'][number]['account']): Promise<boolean> => {
      if (account?.type === 'User') return account.id === me.id;
      if (account?.type === 'Organization') {
        adminOrgs ??= await this.adminOrgLogins(client);
        return adminOrgs.has(account.login);
      }
      return false;
    };
  }

  /** Logins of the orgs where the user is an active admin. A 403/404 (e.g. no Members permission) yields none. */
  private async adminOrgLogins(client: ReturnType<GithubClients['user']>): Promise<Set<string>> {
    const admins = new Set<string>();
    try {
      for (let page = 1; page <= MAX_PAGES; page++) {
        const res = await client.request('GET /user/memberships/orgs', { state: 'active', per_page: PER_PAGE, page });
        const memberships = OrgMemberships.parse(res.data);
        for (const m of memberships) if (m.role === 'admin') admins.add(m.organization.login);
        if (memberships.length < PER_PAGE) break;
      }
    } catch (e) {
      const status = errorStatus(e);
      if (status === 403 || status === 404) return new Set();
      throw e;
    }
    return admins;
  }

  async listRepos(connection: AdapterConnection): Promise<RepoDto[]> {
    const res = await this.clients
      .installation(connection.externalId)
      .request('GET /installation/repositories', { per_page: 100 });
    return ReposResponse.parse(res.data).repositories.map((r) => ({
      repoPath: r.full_name,
      private: r.private,
      defaultBranch: r.default_branch,
    }));
  }

  async mintWorkspaceToken(project: AdapterProject): Promise<{ token: string; expiresAt: Date }> {
    const { repo } = splitRepoPath(project.repoPath);
    const res = await this.clients.app().request('POST /app/installations/{installation_id}/access_tokens', {
      installation_id: Number(project.connectionExternalId),
      repositories: [repo],
      permissions: { contents: 'write', pull_requests: 'write', issues: 'write' },
    });
    const t = TokenResponse.parse(res.data);
    return { token: t.token, expiresAt: new Date(t.expires_at) };
  }

  repoUrl(project: AdapterProject): string {
    const { owner, repo } = splitRepoPath(project.repoPath);
    return `https://github.com/${owner}/${repo}.git`;
  }

  gitCredentialUsername(): string {
    return 'x-access-token';
  }

  cliTokenEnvName(): string {
    return 'GH_TOKEN';
  }

  commitIdentity(user: { login: string; externalId: string }): { name: string; email: string } | null {
    if (!GITHUB_LOGIN.test(user.login) || !GITHUB_USER_ID.test(user.externalId)) return null;
    return { name: user.login, email: `${user.externalId}+${user.login}@users.noreply.github.com` };
  }

  checkoutRef(ticket: CheckoutTicket): string {
    return ticket.kind === 'pr' ? `refs/pull/${ticket.number}/head` : assertSafeRef(ticket.defaultBranch ?? 'main');
  }

  async listSkills(project: AdapterProject): Promise<SkillSummaryDto[]> {
    const seen = new Set<string>();
    const out: SkillSummaryDto[] = [];
    for (const folder of skillFoldersOf(project)) {
      for (const name of await this.skillDirNames(project, folder)) {
        if (seen.has(name)) continue; // the folder searched first wins
        try {
          const { body: _b, sha: _s, ...summary } = await this.readSkillIn(project, folder, name);
          out.push(summary);
          seen.add(name);
        } catch (e) {
          if (!(e instanceof SkillNotFoundError)) throw e; // a directory without SKILL.md is not a skill
        }
      }
    }
    return out;
  }

  /** Names of the sub-directories of a skill folder. A missing folder, or one that is a symlink or a file, has none. */
  private async skillDirNames(project: AdapterProject, folder: string): Promise<string[]> {
    const { owner, repo } = splitRepoPath(project.repoPath);
    let data: unknown;
    try {
      data = (
        await this.clients
          .installation(project.connectionExternalId)
          .request('GET /repos/{owner}/{repo}/contents/{+path}', { owner, repo, path: folder })
      ).data;
    } catch (e) {
      if (errorStatus(e) === 404) return [];
      throw e;
    }
    // GitHub answers a symlink (or a file) with one object instead of a list; the contents API does not follow it.
    if (!Array.isArray(data)) return [];
    return DirEntries.parse(data)
      .filter((x) => x.type === 'dir' && SKILL_NAME.test(x.name))
      .map((x) => x.name);
  }

  async readSkill(project: AdapterProject, name: string): Promise<SkillDto> {
    for (const folder of skillFoldersOf(project)) {
      try {
        return await this.readSkillIn(project, folder, name);
      } catch (e) {
        if (!(e instanceof SkillNotFoundError)) throw e;
      }
    }
    throw new SkillNotFoundError(name);
  }

  /** The folder the skill is in (the one searched first when several have it), or null when none does. */
  private async folderOf(project: AdapterProject, name: string): Promise<string | null> {
    for (const folder of skillFoldersOf(project)) {
      try {
        await this.fetchSkillFile(project, folder, name);
        return folder;
      } catch (e) {
        if (!(e instanceof SkillNotFoundError)) throw e;
      }
    }
    return null;
  }

  /**
   * The SKILL.md of a skill in one folder. Read, list and edit all decide "is it in this folder" here: a missing file,
   * and a SKILL.md that is a symlink or a folder (one object with no content; the contents API does not follow it),
   * are both "not found".
   */
  private async fetchSkillFile(
    project: AdapterProject,
    folder: string,
    name: string,
  ): Promise<{ path: string; file: z.infer<typeof FileResponse> }> {
    const path = skillPath(folder, name);
    const { owner, repo } = splitRepoPath(project.repoPath);
    let data: unknown;
    try {
      data = (
        await this.clients
          .installation(project.connectionExternalId)
          .request('GET /repos/{owner}/{repo}/contents/{+path}', { owner, repo, path })
      ).data;
    } catch (e) {
      if (errorStatus(e) === 404) throw new SkillNotFoundError(name);
      throw e;
    }
    const parsed = FileResponse.safeParse(data);
    if (!parsed.success) throw new SkillNotFoundError(name);
    return { path, file: parsed.data };
  }

  private async readSkillIn(project: AdapterProject, folder: string, name: string): Promise<SkillDto> {
    const { path, file } = await this.fetchSkillFile(project, folder, name);
    const { owner, repo } = splitRepoPath(project.repoPath);
    const octokit = this.clients.installation(project.connectionExternalId);
    if (file.encoding !== 'base64') throw new Error(`unexpected encoding for ${path}`);
    const body = Buffer.from(file.content.replace(/\n/g, ''), 'base64').toString('utf8');
    const commits = CommitList.parse(
      (await octokit.request('GET /repos/{owner}/{repo}/commits', { owner, repo, path, per_page: 1 })).data,
    );
    const c = commits[0];
    return {
      name,
      description: skillDescription(body),
      path,
      lastCommit: c
        ? {
            sha: c.sha,
            message: c.commit.message.split('\n')[0] ?? '',
            at: c.commit.committer?.date ?? this.clock.now().toISOString(),
          }
        : null,
      body,
      sha: file.sha,
    };
  }

  async readRepoFile(project: AdapterProject, path: string): Promise<string | null> {
    if (path.split('/').some((s) => !REPO_FILE_SEGMENT.test(s) || s === '.' || s === '..')) {
      throw new Error('invalid repo file path');
    }
    const { owner, repo } = splitRepoPath(project.repoPath);
    const ref = assertSafeRef(project.defaultBranch ?? 'main');
    let data: unknown;
    try {
      data = (
        await this.clients
          .installation(project.connectionExternalId)
          .request('GET /repos/{owner}/{repo}/contents/{+path}', { owner, repo, path, ref })
      ).data;
    } catch (e) {
      if (errorStatus(e) === 404) return null;
      throw e;
    }
    if (Array.isArray(data)) throw new RepoFileError('path is a directory');
    const file = FileResponse.safeParse(data);
    // Files over 1 MB come back with encoding "none" and no content.
    if (!file.success || file.data.encoding !== 'base64') throw new RepoFileError('not a base64 text file');
    return Buffer.from(file.data.content.replace(/\n/g, ''), 'base64').toString('utf8');
  }

  async writeSkill(
    project: AdapterProject,
    name: string,
    body: string,
    message: string,
    sha?: string,
  ): Promise<SkillChangeResult> {
    // A new skill goes to the default agent's folder. An edit goes to the folder the skill is in (found by its sha).
    const target = skillFoldersOf(project)[0] ?? '';
    const folder = sha ? ((await this.folderOf(project, name)) ?? target) : target;
    const path = skillPath(folder, name);
    const { owner, repo } = splitRepoPath(project.repoPath);
    return this.submit(project, sha ? 'update' : 'create', name, path, message, (octokit, branch) =>
      octokit.request('PUT /repos/{owner}/{repo}/contents/{+path}', {
        owner,
        repo,
        path,
        message,
        content: Buffer.from(body, 'utf8').toString('base64'),
        committer: { name: this.opts.botName, email: this.opts.botEmail },
        ...(sha ? { sha } : {}),
        ...(branch ? { branch } : {}),
      }),
    );
  }

  async deleteSkill(project: AdapterProject, name: string, message: string): Promise<SkillChangeResult> {
    const { owner, repo } = splitRepoPath(project.repoPath);
    const current = await this.readSkill(project, name);
    const path = current.path;
    return this.submit(project, 'delete', name, path, message, (octokit, branch) =>
      octokit.request('DELETE /repos/{owner}/{repo}/contents/{+path}', {
        owner,
        repo,
        path,
        message,
        sha: current.sha,
        committer: { name: this.opts.botName, email: this.opts.botEmail },
        ...(branch ? { branch } : {}),
      }),
    );
  }

  /**
   * Commits straight to the default branch, or, when that branch is protected, to a new branch that gets a PR. The
   * choice comes only from the branch's own `protected` flag; a failed write is never retried as a PR.
   */
  private async submit(
    project: AdapterProject,
    action: 'create' | 'update' | 'delete',
    name: string,
    path: string,
    message: string,
    write: (octokit: GithubInstallationClient, branch?: string) => Promise<{ data: unknown }>,
  ): Promise<SkillChangeResult> {
    const { owner, repo } = splitRepoPath(project.repoPath);
    const octokit = this.clients.installation(project.connectionExternalId);
    const targetBranch = assertSafeRef(project.defaultBranch ?? 'main');
    const commit = async (branch?: string): Promise<string> => {
      try {
        const res = await write(octokit, branch);
        return WriteResponse.parse(res.data).commit.sha;
      } catch (e) {
        const s = errorStatus(e);
        if (s === 409 || s === 422) throw new SkillConflictError(name);
        throw e;
      }
    };

    const meta = BranchResponse.parse(
      (await octokit.request('GET /repos/{owner}/{repo}/branches/{branch}', { owner, repo, branch: targetBranch }))
        .data,
    );
    if (!meta.protected) return { kind: 'commit', commitSha: await commit(), targetBranch };

    // The suffix keeps concurrent submissions apart; creating a ref never overwrites an existing one.
    const sourceBranch = `agent-desk/skill-${action}-${name}-${this.clock.now().getTime().toString(36)}`;
    try {
      await octokit.request('POST /repos/{owner}/{repo}/git/refs', {
        owner,
        repo,
        ref: `refs/heads/${sourceBranch}`,
        sha: meta.commit.sha,
      });
    } catch (e) {
      throw refCreateError(e, name);
    }
    let stage: 'commit' | 'change_request' = 'commit';
    try {
      await commit(sourceBranch);
      stage = 'change_request';
      const verb = action[0]?.toUpperCase() + action.slice(1);
      const pr = PullResponse.parse(
        (
          await octokit.request('POST /repos/{owner}/{repo}/pulls', {
            owner,
            repo,
            title: `${verb} skill: ${name}`,
            head: sourceBranch,
            base: targetBranch,
            body: `${verb} skill \`${name}\` (\`${path}\`).\n\n${message}`,
          })
        ).data,
      );
      return { kind: 'change_request', sourceBranch, targetBranch, url: pr.html_url, id: String(pr.number) };
    } catch (e) {
      await this.dropBranch(octokit, owner, repo, sourceBranch);
      if (e instanceof SkillConflictError) throw e;
      throw new SkillChangeRequestError(isPermissionStatus(errorStatus(e)) ? 'permission' : stage, name);
    }
  }

  /** Best effort: a leftover branch must not hide the error that made us give up. */
  private async dropBranch(
    octokit: GithubInstallationClient,
    owner: string,
    repo: string,
    branch: string,
  ): Promise<void> {
    try {
      await octokit.request('DELETE /repos/{owner}/{repo}/git/refs/{+ref}', { owner, repo, ref: `heads/${branch}` });
    } catch {
      // ignore
    }
  }
}
