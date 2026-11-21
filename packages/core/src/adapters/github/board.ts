import type { PrState } from '@agentdesk/contracts';
import { z } from 'zod';
import type { Clock } from '../../clock';
import type {
  AdapterProject,
  BoardAdapter,
  PollCursor,
  PollResult,
  PrStatesResult,
  SecretLookup,
  Ticket,
  TicketEvent,
  WebhookHeaders,
} from '../types';
import { errorHeaders, errorStatus, splitRepoPath, type GithubClients } from './app';
import { normalizeLinkedRefs } from '../linked-refs';
import { headerValue, parseIssueComment, verifyGithubSignature } from './webhook';

const MAX_PAGES = 10;
const MAX_BODY_SCAN = 65_536;
const CLOSING_KEYWORD = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\b:?\s{1,10}#(\d+)/gi;

/** Minimal logger the adapter warns through; fields carry error names only, never ticket text. */
export interface AdapterLog {
  warn(fields: { err: string }, msg: string): void;
}

/** Same-repo issue numbers named by closing keywords in a PR description (first 65,536 characters).
 *  `owner/repo#n`, URLs and a bare '#n' without a keyword are not matched. Raw strings: normalizeLinkedRefs cleans them. */
export function closingRefsInBody(body: string): string[] {
  const refs: string[] = [];
  for (const m of body.slice(0, MAX_BODY_SCAN).matchAll(CLOSING_KEYWORD)) if (m[1]) refs.push(m[1]);
  return refs;
}

/** Variables only: { owner, repo, number }. Nothing from a ticket is ever interpolated into the query. */
export const CLOSING_ISSUES_QUERY = `query ClosingIssues($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      closingIssuesReferences(first: 10) {
        nodes { number repository { nameWithOwner } }
      }
    }
  }
}`;

const ClosingIssuesResponse = z.object({
  repository: z.object({
    pullRequest: z.object({
      closingIssuesReferences: z.object({
        nodes: z.array(
          z.object({ number: z.number().int(), repository: z.object({ nameWithOwner: z.string() }) }).nullable(),
        ),
      }),
    }),
  }),
});

const PR_REF = /^[1-9]\d{0,9}$/;
const GRAPHQL_INT_MAX = 2147483647;

/** `query PrStates($owner, $repo, $n0 … ) { repository(...) { p0: pullRequest(number: $n0) { number state isDraft merged } … } }`.
 *  Owner, repo and numbers are variables only: nothing from a ticket is interpolated (rule 6). */
export function prStatesQuery(count: number): string {
  const vars = Array.from({ length: count }, (_, i) => `$n${i}: Int!`).join(', ');
  const nodes = Array.from(
    { length: count },
    (_, i) => `p${i}: pullRequest(number: $n${i}) { number state isDraft merged }`,
  ).join(' ');
  return `query PrStates($owner: String!, $repo: String!${count ? ', ' : ''}${vars}) { repository(owner: $owner, name: $repo) { ${nodes} } }`;
}

/** Display precedence: merged > closed (draft or not) > open draft > open. Anything else is unknown. */
export function prStateOf(node: { state: string; isDraft: boolean; merged: boolean }): PrState | undefined {
  if (node.merged || node.state === 'MERGED') return 'merged';
  if (node.state === 'CLOSED') return 'closed';
  if (node.state === 'OPEN') return node.isDraft ? 'draft' : 'open';
  return undefined;
}

const PrStatesResponse = z.object({ repository: z.record(z.string(), z.unknown()) });
const PrStatesErrors = z.array(z.object({ type: z.string().optional(), path: z.array(z.unknown()).optional() }));
const PrStateNode = z.object({
  number: z.number().int(),
  state: z.string(),
  isDraft: z.boolean(),
  merged: z.boolean(),
});

const CommentList = z.array(
  z.object({
    id: z.number(),
    issue_url: z.string(),
    user: z.object({ login: z.string(), id: z.number() }).nullable(),
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
  body: z.string().nullable().optional(),
  labels: z.array(
    z.union([z.string(), z.object({ name: z.string().optional(), color: z.string().nullable().optional() })]),
  ),
});

const CreatedComment = z.object({ id: z.number() });

/** Only follow pagination links on the API origin, so a crafted Link header cannot send the token elsewhere. */
function sameOriginLink(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && u.host === 'api.github.com' ? u.toString() : undefined;
  } catch {
    return undefined;
  }
}

export class GithubBoardAdapter implements BoardAdapter {
  constructor(
    private readonly clients: GithubClients,
    private readonly clock: Clock,
    private readonly fallbackSecret?: string,
    private readonly log?: AdapterLog,
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
            ...(c.user ? { authorId: String(c.user.id) } : {}),
            authorAssociation: c.author_association,
            createdAt: c.created_at,
          });
        }
        const link = res.headers.link ?? '';
        next = sameOriginLink(/<([^>]+)>;\s*rel="next"/.exec(link)?.[1]);
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
    const kind = t.pull_request !== undefined ? 'pr' : 'issue';
    const linkedRefs =
      kind === 'pr'
        ? normalizeLinkedRefs([
            ...closingRefsInBody(t.body ?? ''),
            ...(await this.closingIssueRefs(project.connectionExternalId, owner, repo, t.number)),
          ])
        : [];
    return {
      ref: String(t.number),
      kind,
      number: t.number,
      title: t.title,
      url: t.html_url,
      labels: t.labels.flatMap((l) =>
        typeof l === 'string' ? [{ name: l, color: '' }] : l.name ? [{ name: l.name, color: l.color ?? '' }] : [],
      ),
      linkedRefs,
    };
  }

  /** Same-repo issues GitHub links to a PR. Any failure (HTTP, errors payload, schema) yields [] and a warn with the error name only. */
  private async closingIssueRefs(externalId: string, owner: string, repo: string, number: number): Promise<string[]> {
    try {
      const res = ClosingIssuesResponse.parse(
        await this.clients.installation(externalId).graphql(CLOSING_ISSUES_QUERY, { owner, repo, number }),
      );
      const repoPath = `${owner}/${repo}`.toLowerCase();
      return res.repository.pullRequest.closingIssuesReferences.nodes.flatMap((n) =>
        n && n.repository.nameWithOwner.toLowerCase() === repoPath ? [String(n.number)] : [],
      );
    } catch (e) {
      this.log?.warn({ err: e instanceof Error ? e.name : 'UnknownError' }, 'ticket links unavailable');
      return [];
    }
  }

  async prStates(project: AdapterProject, refs: string[]): Promise<PrStatesResult> {
    const asked = [...new Set(refs.filter((r) => PR_REF.test(r) && Number(r) <= GRAPHQL_INT_MAX))];
    const out = new Map<string, PrState>();
    // Refs that can never be a PR number are authoritatively absent; they are not sent.
    const unresolved = new Set(refs.filter((r) => !asked.includes(r)));
    if (asked.length === 0) return { states: out, unresolved };
    const { owner, repo } = splitRepoPath(project.repoPath);
    const variables: Record<string, string | number> = { owner, repo };
    asked.forEach((r, i) => (variables[`n${i}`] = Number(r)));
    let raw: unknown;
    // Aliases (p0..pN) GitHub reported NOT_FOUND for, and whether any other error leaves a missing ref undecided.
    const notFound = new Set<string>();
    let undecided: Set<string> | 'all' = new Set();
    let partialAnswer = false;
    try {
      raw = await this.clients
        .installation(project.connectionExternalId)
        .graphql(prStatesQuery(asked.length), variables);
    } catch (e) {
      // GraphQL errors can carry partial data: use it. Anything else (HTTP, network, no usable data) rejects.
      const partial = PrStatesResponse.safeParse(
        typeof e === 'object' && e !== null && 'data' in e ? e.data : undefined,
      );
      if (!partial.success) throw e;
      this.log?.warn({ err: e instanceof Error ? e.name : 'UnknownError' }, 'pr states partial');
      raw = partial.data;
      partialAnswer = true;
      const errors = PrStatesErrors.safeParse(
        typeof e === 'object' && e !== null && 'errors' in e ? e.errors : undefined,
      );
      // Errors that cannot be read are treated as one that cannot be attributed to a node.
      for (const err of errors.success ? errors.data : [{}]) {
        const alias = err.path?.[0] === 'repository' ? err.path[1] : undefined;
        if (typeof alias !== 'string') undecided = 'all';
        else if (err.type === 'NOT_FOUND') notFound.add(alias);
        else if (undecided !== 'all') undecided.add(alias);
      }
    }
    const { repository } = PrStatesResponse.parse(raw);
    const askedSet = new Set(asked);
    for (const value of Object.values(repository)) {
      const node = PrStateNode.safeParse(value);
      if (!node.success || !askedSet.has(String(node.data.number))) continue;
      const state = prStateOf(node.data);
      if (state) out.set(String(node.data.number), state);
    }
    asked.forEach((ref, i) => {
      if (out.has(ref)) return;
      const alias = `p${i}`;
      // A complete answer rules on every ask. In a partial one only a lone NOT_FOUND on the node does.
      if (!partialAnswer || (undecided !== 'all' && notFound.has(alias) && !undecided.has(alias))) unresolved.add(ref);
    });
    return { states: out, unresolved };
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
