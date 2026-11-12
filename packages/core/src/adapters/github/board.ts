import { z } from 'zod';
import type { Clock } from '../../clock';
import type {
  AdapterProject,
  BoardAdapter,
  PollCursor,
  PollResult,
  SecretLookup,
  Ticket,
  TicketEvent,
  WebhookHeaders,
} from '../types';
import { errorHeaders, errorStatus, splitRepoPath, type GithubClients } from './app';
import { headerValue, parseIssueComment, verifyGithubSignature } from './webhook';

const MAX_PAGES = 10;

const CommentList = z.array(
  z.object({
    id: z.number(),
    issue_url: z.string(),
    user: z.object({ login: z.string() }).nullable(),
    created_at: z.string(),
    updated_at: z.string(),
    author_association: z.string(),
    body: z.string().nullable().optional(),
  }),
);

const IssueBody = z.object({
  number: z.number().int(),
  title: z.string(),
  html_url: z.string(),
  pull_request: z.unknown().optional(),
  labels: z.array(
    z.union([z.string(), z.object({ name: z.string().optional(), color: z.string().nullable().optional() })]),
  ),
});

const CreatedComment = z.object({ id: z.number() });

export class GithubBoardAdapter implements BoardAdapter {
  constructor(
    private readonly clients: GithubClients,
    private readonly clock: Clock,
    private readonly fallbackSecret?: string,
  ) {}

  async verifyAndParseWebhook(
    headers: WebhookHeaders,
    rawBody: Buffer | string,
    secretLookup: SecretLookup,
  ): Promise<TicketEvent | null | 'bad_signature'> {
    const secret = (await secretLookup()) ?? this.fallbackSecret;
    const sig = headerValue(headers, 'x-hub-signature-256');
    if (!secret || !sig || !verifyGithubSignature(rawBody, sig, secret)) return 'bad_signature';
    return parseIssueComment(headers, rawBody);
  }

  async pollEvents(project: AdapterProject, cursor: PollCursor): Promise<PollResult> {
    const { owner, repo } = splitRepoPath(project.repoPath);
    const octokit = this.clients.installation(project.connectionExternalId);
    const events: TicketEvent[] = [];
    let since = cursor.since;
    let etag: string | null = cursor.etag;
    try {
      let next: string | undefined;
      for (let page = 0; page < MAX_PAGES; page++) {
        const res = next
          ? await octokit.request({ method: 'GET', url: next })
          : await octokit.request('GET /repos/{owner}/{repo}/issues/comments', {
              owner,
              repo,
              since: cursor.since,
              sort: 'updated',
              direction: 'asc',
              per_page: 100,
              ...(cursor.etag ? { headers: { 'if-none-match': cursor.etag } } : {}),
            });
        if (page === 0) etag = res.headers.etag ?? null;
        for (const c of CommentList.parse(res.data)) {
          if (c.updated_at > since) since = c.updated_at;
          if (Date.parse(c.created_at) < Date.parse(cursor.since)) continue;
          events.push({
            provider: 'github',
            deliveryId: `poll-${c.id}`,
            commentId: String(c.id),
            externalId: project.connectionExternalId,
            repoPath: project.repoPath,
            ticketRef: c.issue_url.slice(c.issue_url.lastIndexOf('/') + 1),
            body: c.body ?? '',
            author: c.user?.login ?? 'ghost',
            authorAssociation: c.author_association,
            createdAt: c.created_at,
          });
        }
        const link = res.headers.link ?? '';
        next = /<([^>]+)>;\s*rel="next"/.exec(link)?.[1];
        if (!next) break;
      }
    } catch (e) {
      return this.classify(e);
    }
    return { kind: 'events', events, cursor: { since, etag: since === cursor.since ? etag : null } };
  }

  private classify(e: unknown): PollResult {
    const status = errorStatus(e);
    const h = errorHeaders(e);
    if (status === 304) return { kind: 'not_modified' };
    if (status === 403 || status === 429) {
      if (h['x-ratelimit-remaining'] === '0' && h['x-ratelimit-reset']) {
        return { kind: 'rate_limited', resetAt: new Date(Number(h['x-ratelimit-reset']) * 1000) };
      }
      if (h['retry-after']) {
        return {
          kind: 'rate_limited',
          resetAt: new Date(this.clock.now().getTime() + Number(h['retry-after']) * 1000),
        };
      }
      if (status === 429) return { kind: 'rate_limited', resetAt: new Date(this.clock.now().getTime() + 60_000) };
      return { kind: 'revoked' };
    }
    if (status === 401 || status === 404) return { kind: 'revoked' };
    throw e;
  }

  async getTicket(project: AdapterProject, ref: string): Promise<Ticket> {
    const { owner, repo } = splitRepoPath(project.repoPath);
    const number = Number(ref);
    if (!Number.isInteger(number) || number < 1) throw new Error(`invalid ticket ref "${ref}"`);
    const res = await this.clients
      .installation(project.connectionExternalId)
      .request('GET /repos/{owner}/{repo}/issues/{issue_number}', { owner, repo, issue_number: number });
    const t = IssueBody.parse(res.data);
    return {
      ref: String(t.number),
      kind: t.pull_request !== undefined ? 'pr' : 'issue',
      number: t.number,
      title: t.title,
      url: t.html_url,
      labels: t.labels.flatMap((l) =>
        typeof l === 'string' ? [{ name: l, color: '' }] : l.name ? [{ name: l.name, color: l.color ?? '' }] : [],
      ),
    };
  }

  async comment(project: AdapterProject, ref: string, text: string): Promise<string> {
    const { owner, repo } = splitRepoPath(project.repoPath);
    const number = Number(ref);
    if (!Number.isInteger(number) || number < 1) throw new Error(`invalid ticket ref "${ref}"`);
    const res = await this.clients
      .installation(project.connectionExternalId)
      .request('POST /repos/{owner}/{repo}/issues/{issue_number}/comments', {
        owner,
        repo,
        issue_number: number,
        body: text,
      });
    return String(CreatedComment.parse(res.data).id);
  }
}
