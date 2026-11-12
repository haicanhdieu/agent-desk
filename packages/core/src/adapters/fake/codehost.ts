import type { RepoDto, SkillDto, SkillSummaryDto } from '@agentdesk/contracts';
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
import { FAKE_EXTERNAL_ID } from './board';
import { FAKE_REPOS, sha1, type FakeStore } from './store';

const TOKEN_TTL_MS = 60 * 60 * 1000;

export class FakeCodeHostAdapter implements CodeHostAdapter {
  constructor(
    private readonly store: FakeStore,
    private readonly clock: Clock,
    private readonly publicOrigin: string,
    private readonly repos: string[] = FAKE_REPOS,
  ) {}

  installUrl(_orgId: string, state: string): string {
    return `${this.publicOrigin}/connections/fake/callback?state=${encodeURIComponent(state)}`;
  }

  async completeInstall(_params: Record<string, string>, _user: InstallUser): Promise<NewConnection> {
    return {
      provider: 'fake',
      externalId: FAKE_EXTERNAL_ID,
      accountName: 'dev',
      capabilities: { code: true, board: true },
    };
  }

  async listRepos(_connection: AdapterConnection): Promise<RepoDto[]> {
    return this.repos.map((repoPath) => ({ repoPath, private: false, defaultBranch: 'main' }));
  }

  async mintWorkspaceToken(_project: AdapterProject): Promise<{ token: string; expiresAt: Date }> {
    return { token: 'fake-workspace-token', expiresAt: new Date(this.clock.now().getTime() + TOKEN_TTL_MS) };
  }

  cloneUrl(project: AdapterProject, _token: string): string {
    return `https://fake.invalid/${project.repoPath}.git`;
  }

  checkoutRef(ticket: CheckoutTicket): string {
    return ticket.kind === 'pr' ? `refs/pull/${ticket.number}/head` : ticket.defaultBranch ?? 'main';
  }

  async listSkills(project: AdapterProject): Promise<SkillSummaryDto[]> {
    const out: SkillSummaryDto[] = [];
    for (const name of await this.store.listSkillNames(project.repoPath)) {
      const f = await this.store.readSkillFile(project.repoPath, name);
      if (!f) continue;
      out.push(this.summary(name, f));
    }
    return out;
  }

  async readSkill(project: AdapterProject, name: string): Promise<SkillDto> {
    const f = await this.store.readSkillFile(project.repoPath, name);
    if (!f) throw new SkillNotFoundError(name);
    return { ...this.summary(name, f), body: f.body, sha: f.sha };
  }

  async writeSkill(
    project: AdapterProject,
    name: string,
    body: string,
    _message: string,
    sha?: string,
  ): Promise<{ commitSha: string }> {
    const existing = await this.store.readSkillFile(project.repoPath, name);
    if (existing && sha !== undefined && sha !== existing.sha) throw new SkillConflictError(name);
    return { commitSha: await this.store.writeSkillFile(project.repoPath, name, body) };
  }

  async deleteSkill(project: AdapterProject, name: string, _message: string): Promise<void> {
    if (!(await this.store.deleteSkillFile(project.repoPath, name))) throw new SkillNotFoundError(name);
  }

  private summary(name: string, f: { body: string; sha: string; mtime: string }): SkillSummaryDto {
    return {
      name,
      description: skillDescription(f.body),
      path: `${SKILLS_DIR}/${name}/SKILL.md`,
      lastCommit: { sha: f.sha || sha1(f.body), message: `Update ${name}`, at: f.mtime },
    };
  }
}
