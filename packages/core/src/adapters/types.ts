import type { Provider, RepoDto, SkillDto, SkillSummaryDto, TicketKind } from '@agentdesk/contracts';

export type { Provider };

export interface TicketEvent {
  provider: Provider;
  deliveryId: string;
  commentId: string;
  /** Provider-side id of the connection (installation, workspace, ...); used for cross-tenant project resolution. */
  externalId: string;
  repoPath: string;
  ticketRef: string;
  ticketKind?: TicketKind;
  body: string;
  author: string;
  authorAssociation: string;
  createdAt: string;
}

export interface Ticket {
  ref: string;
  kind: TicketKind;
  number: number;
  title: string;
  url: string;
  labels: { name: string; color: string }[];
}

export interface PollCursor {
  since: string;
  etag: string | null;
}

export type PollResult =
  | { kind: 'events'; events: TicketEvent[]; cursor: PollCursor }
  | { kind: 'not_modified' }
  | { kind: 'rate_limited'; resetAt: Date }
  | { kind: 'revoked' };

/** The slice of a project that adapters need. */
export interface AdapterProject {
  repoPath: string;
  /** `externalId` of the connection that grants access to the repo. */
  connectionExternalId: string;
  defaultBranch?: string;
}

export interface AdapterConnection {
  externalId: string;
}

export interface NewConnection {
  provider: Provider;
  externalId: string;
  accountName: string;
  capabilities: { code: boolean; board: boolean };
}

export interface InstallUser {
  userId: string;
  /** Organization the connection is being installed for. */
  orgId?: string;
  /** OAuth token of the user's linked account at this provider, if any. */
  linkedAccountToken: string | null;
}

export interface CheckoutTicket {
  kind: TicketKind;
  number: number;
  defaultBranch?: string;
}

export type WebhookHeaders = Record<string, string | string[] | undefined>;
/** Resolves the webhook signing secret (undefined when none is configured). */
export type SecretLookup = () => Promise<string | undefined>;

export interface BoardAdapter {
  verifyAndParseWebhook(
    headers: WebhookHeaders,
    rawBody: Buffer | string,
    secretLookup: SecretLookup,
  ): Promise<TicketEvent | null | 'bad_signature'>;
  pollEvents(project: AdapterProject, cursor: PollCursor): Promise<PollResult>;
  getTicket(project: AdapterProject, ref: string): Promise<Ticket>;
  /** Returns the new comment's id. */
  comment(project: AdapterProject, ref: string, text: string): Promise<string>;
}

export interface CodeHostAdapter {
  installUrl(orgId: string, state: string): string;
  completeInstall(params: Record<string, string>, user: InstallUser): Promise<NewConnection>;
  listRepos(connection: AdapterConnection): Promise<RepoDto[]>;
  mintWorkspaceToken(project: AdapterProject): Promise<{ token: string; expiresAt: Date }>;
  cloneUrl(project: AdapterProject, token: string): string;
  checkoutRef(ticket: CheckoutTicket): string;
  listSkills(project: AdapterProject): Promise<SkillSummaryDto[]>;
  readSkill(project: AdapterProject, name: string): Promise<SkillDto>;
  writeSkill(
    project: AdapterProject,
    name: string,
    body: string,
    message: string,
    sha?: string,
  ): Promise<{ commitSha: string }>;
  deleteSkill(project: AdapterProject, name: string, message: string): Promise<void>;
}

/** Thrown by adapters when a skill write races another write (sha mismatch). */
export class SkillConflictError extends Error {
  constructor(name: string) {
    super(`skill ${name} changed since it was read`);
    this.name = 'SkillConflictError';
  }
}

/** Thrown when a skill does not exist. */
export class SkillNotFoundError extends Error {
  constructor(name: string) {
    super(`skill ${name} not found`);
    this.name = 'SkillNotFoundError';
  }
}

export interface AdapterRegistry {
  board(provider: Provider): BoardAdapter;
  codeHost(provider: Provider): CodeHostAdapter;
  providers(): Provider[];
}

export const SKILLS_DIR = '.claude/skills';

/** Extracts `description:` from SKILL.md front-matter ('' when absent). */
export function skillDescription(body: string): string {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(body);
  if (!m?.[1]) return '';
  const line = m[1].split(/\r?\n/).find((l) => l.startsWith('description:'));
  if (!line) return '';
  const v = line.slice('description:'.length).trim();
  return v.replace(/^(["'])(.*)\1$/, '$2');
}
