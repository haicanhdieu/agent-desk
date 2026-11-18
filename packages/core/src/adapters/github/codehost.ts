import type { RepoDto, SkillDto, SkillSummaryDto } from '@agentdesk/contracts';
import { z } from 'zod';
import type { Clock } from '../../clock';
import {
  SKILLS_DIR,
  SkillConflictError,
  SkillNotFoundError,
  skillDescription,
  type AdapterConnection,
  type AdapterProject,
  type CheckoutTicket,
  type CodeHostAdapter,
  RepoFileError,
  type InstallUser,
  type NewConnection,
} from '../types';
import { assertSafeRef, errorStatus, splitRepoPath, type GithubClients } from './app';

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
const UserInstallations = z.object({
  installations: z.array(
    z.object({
      id: z.number(),
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
  account: z.object({ login: z.string() }).nullable(),
});

function skillPath(name: string): string {
  if (!SKILL_NAME.test(name)) throw new Error(`invalid skill name "${name}"`);
  return `${SKILLS_DIR}/${name}/SKILL.md`;
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

  /** The installation must be visible to the user's own linked account, so one user cannot claim another's install. */
  async completeInstall(params: Record<string, string>, user: InstallUser): Promise<NewConnection> {
    const installationId = Number(params.installation_id);
    if (!Number.isInteger(installationId) || installationId < 1) throw new Error('missing installation_id');
    if (!user.linkedAccountToken) throw new Error('no linked account for this user');
    // The user's token is only used for this one access check and is never stored or logged.
    const userClient = this.clients.user(user.linkedAccountToken);
    const visible = UserInstallations.parse(
      (await userClient.request('GET /user/installations', { per_page: 100 })).data,
    );
    if (!visible.installations.some((i) => i.id === installationId)) {
      throw new Error('installation is not accessible to this user');
    }
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
    const me = GithubUser.parse((await client.request('GET /user')).data);
    let adminOrgs: Set<string> | undefined; // fetched once, and only if an org install shows up
    const out: NewConnection[] = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const res = await client.request('GET /user/installations', { per_page: PER_PAGE, page });
      const { installations } = UserInstallations.parse(res.data);
      for (const i of installations) {
        let owned = false;
        if (i.account?.type === 'User') owned = i.account.id === me.id;
        else if (i.account?.type === 'Organization') {
          adminOrgs ??= await this.adminOrgLogins(client);
          owned = adminOrgs.has(i.account.login);
        }
        if (!owned) continue;
        out.push({
          provider: 'github',
          externalId: String(i.id),
          accountName: i.account?.login ?? String(i.id),
          capabilities: { code: true, board: true },
        });
      }
      if (installations.length < PER_PAGE) break;
    }
    return out;
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
    const { owner, repo } = splitRepoPath(project.repoPath);
    let entries: z.infer<typeof DirEntries>;
    try {
      const res = await this.clients
        .installation(project.connectionExternalId)
        .request('GET /repos/{owner}/{repo}/contents/{+path}', { owner, repo, path: SKILLS_DIR });
      entries = DirEntries.parse(res.data);
    } catch (e) {
      if (errorStatus(e) === 404) return [];
      throw e;
    }
    const out: SkillSummaryDto[] = [];
    for (const d of entries.filter((x) => x.type === 'dir' && SKILL_NAME.test(x.name))) {
      try {
        const s = await this.readSkill(project, d.name);
        const { body: _b, sha: _s, ...summary } = s;
        out.push(summary);
      } catch (e) {
        if (!(e instanceof SkillNotFoundError)) throw e; // a directory without SKILL.md is not a skill
      }
    }
    return out;
  }

  async readSkill(project: AdapterProject, name: string): Promise<SkillDto> {
    const path = skillPath(name);
    const { owner, repo } = splitRepoPath(project.repoPath);
    const octokit = this.clients.installation(project.connectionExternalId);
    let file: z.infer<typeof FileResponse>;
    try {
      file = FileResponse.parse(
        (await octokit.request('GET /repos/{owner}/{repo}/contents/{+path}', { owner, repo, path })).data,
      );
    } catch (e) {
      if (errorStatus(e) === 404) throw new SkillNotFoundError(name);
      throw e;
    }
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
  ): Promise<{ commitSha: string }> {
    const path = skillPath(name);
    const { owner, repo } = splitRepoPath(project.repoPath);
    try {
      const res = await this.clients
        .installation(project.connectionExternalId)
        .request('PUT /repos/{owner}/{repo}/contents/{+path}', {
          owner,
          repo,
          path,
          message,
          content: Buffer.from(body, 'utf8').toString('base64'),
          committer: { name: this.opts.botName, email: this.opts.botEmail },
          ...(sha ? { sha } : {}),
        });
      return { commitSha: WriteResponse.parse(res.data).commit.sha };
    } catch (e) {
      const s = errorStatus(e);
      if (s === 409 || s === 422) throw new SkillConflictError(name);
      throw e;
    }
  }

  async deleteSkill(project: AdapterProject, name: string, message: string): Promise<void> {
    const path = skillPath(name);
    const { owner, repo } = splitRepoPath(project.repoPath);
    const current = await this.readSkill(project, name);
    try {
      await this.clients
        .installation(project.connectionExternalId)
        .request('DELETE /repos/{owner}/{repo}/contents/{+path}', {
          owner,
          repo,
          path,
          message,
          sha: current.sha,
          committer: { name: this.opts.botName, email: this.opts.botEmail },
        });
    } catch (e) {
      const s = errorStatus(e);
      if (s === 409 || s === 422) throw new SkillConflictError(name);
      throw e;
    }
  }
}
