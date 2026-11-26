import type { RepoDto, SkillDto, SkillSummaryDto } from '@agentdesk/contracts';
import type { Clock } from '../../clock';
import {
  skillFoldersOf,
  SkillConflictError,
  SkillNotFoundError,
  skillDescription,
  type AdapterConnection,
  type AdapterProject,
  type CheckoutTicket,
  type CodeHostAdapter,
  type InstallUser,
  type NewConnection,
  type SkillChangeResult,
} from '../types';
import { FAKE_EXTERNAL_ID } from './board';
import { FAKE_REPOS, sha1, type FakeStore } from './store';

const TOKEN_TTL_MS = 60 * 60 * 1000;
const FAKE_LOGIN = /^[A-Za-z0-9][A-Za-z0-9-]*$/;

export class FakeCodeHostAdapter implements CodeHostAdapter {
  constructor(
    private readonly store: FakeStore,
    private readonly clock: Clock,
    private readonly publicOrigin: string,
    private readonly repos: string[] = FAKE_REPOS,
  ) {}

  installUrl(_orgId: string, state: string): string {
    return `${this.publicOrigin}/api/connections/fake/callback?state=${encodeURIComponent(state)}`;
  }

  async completeInstall(_params: Record<string, string>, user: InstallUser): Promise<NewConnection> {
    return {
      provider: 'fake',
      // Org-specific so every org can install the fake provider (external ids are unique across orgs).
      externalId: user.orgId ? `fake-${user.orgId}` : FAKE_EXTERNAL_ID,
      accountName: 'dev',
      capabilities: { code: true, board: true },
    };
  }

  /** The fake provider always redirects back, so there is never an earlier install to find. */
  async listInstallations(_user: InstallUser): Promise<NewConnection[]> {
    return [];
  }

  async listRepos(_connection: AdapterConnection): Promise<RepoDto[]> {
    return this.repos.map((repoPath) => ({ repoPath, private: false, defaultBranch: 'main' }));
  }

  async mintWorkspaceToken(_project: AdapterProject): Promise<{ token: string; expiresAt: Date }> {
    return { token: 'fake-workspace-token', expiresAt: new Date(this.clock.now().getTime() + TOKEN_TTL_MS) };
  }

  repoUrl(project: AdapterProject): string {
    return `https://fake.invalid/${project.repoPath}.git`;
  }

  gitCredentialUsername(): string {
    return 'x-access-token';
  }

  cliTokenEnvName(): string {
    return 'GH_TOKEN';
  }

  commitIdentity(user: { login: string; externalId: string }): { name: string; email: string } | null {
    if (!FAKE_LOGIN.test(user.login)) return null;
    return { name: user.login, email: `${user.login}@users.noreply.fake.invalid` };
  }

  checkoutRef(ticket: CheckoutTicket): string {
    return ticket.kind === 'pr' ? `refs/pull/${ticket.number}/head` : (ticket.defaultBranch ?? 'main');
  }

  async listSkills(project: AdapterProject): Promise<SkillSummaryDto[]> {
    const seen = new Set<string>();
    const out: SkillSummaryDto[] = [];
    for (const folder of skillFoldersOf(project)) {
      for (const name of await this.store.listSkillNames(project.repoPath, folder)) {
        if (seen.has(name)) continue; // the folder searched first wins
        const f = await this.store.readSkillFile(project.repoPath, folder, name);
        if (!f) continue;
        seen.add(name);
        out.push(this.summary(folder, name, f));
      }
    }
    return out;
  }

  async readSkill(project: AdapterProject, name: string): Promise<SkillDto> {
    const found = await this.find(project, name);
    if (!found) throw new SkillNotFoundError(name);
    return { ...this.summary(found.folder, name, found.file), body: found.file.body, sha: found.file.sha };
  }

  /** The skill in the first folder that has it. */
  private async find(
    project: AdapterProject,
    name: string,
  ): Promise<{ folder: string; file: { body: string; sha: string; mtime: string } } | null> {
    for (const folder of skillFoldersOf(project)) {
      const file = await this.store.readSkillFile(project.repoPath, folder, name);
      if (file) return { folder, file };
    }
    return null;
  }

  async readRepoFile(project: AdapterProject, path: string): Promise<string | null> {
    return this.store.readRepoFile(project.repoPath, path);
  }

  async writeSkill(
    project: AdapterProject,
    name: string,
    body: string,
    message: string,
    sha?: string,
  ): Promise<SkillChangeResult> {
    // GitHub semantics: updating needs the current sha; creating must not carry one.
    const given = sha === '' ? undefined : sha; // empty sha is treated as absent, like GitHub
    // A new skill goes to the default agent's folder; an edit goes to the folder the skill is in.
    const target = skillFoldersOf(project)[0] ?? '';
    const folder = given === undefined ? target : ((await this.find(project, name))?.folder ?? target);
    const existing = await this.store.readSkillFile(project.repoPath, folder, name);
    if (existing ? given !== existing.sha : given !== undefined) throw new SkillConflictError(name);
    if (await this.store.isBranchProtected(project.repoPath)) {
      return this.changeRequest(project, existing ? 'update' : 'create', name, message);
    }
    const commitSha = await this.store.writeSkillFile(project.repoPath, folder, name, body);
    return { kind: 'commit', commitSha, targetBranch: project.defaultBranch ?? 'main' };
  }

  async deleteSkill(project: AdapterProject, name: string, message: string): Promise<SkillChangeResult> {
    const found = await this.find(project, name);
    if (!found) throw new SkillNotFoundError(name);
    if (await this.store.isBranchProtected(project.repoPath)) {
      return this.changeRequest(project, 'delete', name, message);
    }
    if (!(await this.store.deleteSkillFile(project.repoPath, found.folder, name))) throw new SkillNotFoundError(name);
    return {
      kind: 'commit',
      commitSha: sha1(`delete:${name}:${message}`),
      targetBranch: project.defaultBranch ?? 'main',
    };
  }

  private async changeRequest(
    project: AdapterProject,
    action: 'create' | 'update' | 'delete',
    name: string,
    message: string,
  ): Promise<SkillChangeResult> {
    const targetBranch = project.defaultBranch ?? 'main';
    const sourceBranch = `agent-desk/skill-${action}-${name}-${this.clock.now().getTime().toString(36)}`;
    const id = await this.store.addChangeRequest({
      repoPath: project.repoPath,
      sourceBranch,
      targetBranch,
      title: `${action[0]?.toUpperCase()}${action.slice(1)} skill: ${name}`,
      message,
    });
    return {
      kind: 'change_request',
      sourceBranch,
      targetBranch,
      url: `${this.publicOrigin}/fake/${project.repoPath}/pulls/${id}`,
      id,
    };
  }

  private summary(folder: string, name: string, f: { body: string; sha: string; mtime: string }): SkillSummaryDto {
    return {
      name,
      description: skillDescription(f.body),
      path: `${folder}/${name}/SKILL.md`,
      lastCommit: { sha: f.sha || sha1(f.body), message: `Update ${name}`, at: f.mtime },
    };
  }
}
