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
const UserInstallations = z.object({ installations: z.array(z.object({ id: z.number() })) });
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

  cloneUrl(project: AdapterProject, token: string): string {
    const { owner, repo } = splitRepoPath(project.repoPath);
    return `https://x-access-token:${token}@github.com/${owner}/${repo}.git`;
  }

  runEnv(token: string): Record<string, string> {
    return { GH_TOKEN: token };
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
