import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { TicketEvent, WebhookHeaders } from '../types';

export function headerValue(headers: WebhookHeaders, name: string): string | undefined {
  const v = headers[name];
  return Array.isArray(v) ? v[0] : v;
}

/** Constant-time check of an `X-Hub-Signature-256` value (`sha256=<hex>`) over the raw body. */
export function verifyGithubSignature(rawBody: Buffer | string, header: string, secret: string): boolean {
  const prefix = 'sha256=';
  if (!header.startsWith(prefix)) return false;
  const hex = header.slice(prefix.length);
  if (!/^[0-9a-fA-F]+$/.test(hex)) return false;
  const got = Buffer.from(hex, 'hex');
  const expected = createHmac('sha256', secret).update(rawBody).digest();
  return got.length === expected.length && timingSafeEqual(got, expected);
}

const IssueCommentPayload = z.object({
  action: z.string(),
  issue: z.object({ number: z.number().int(), pull_request: z.unknown().optional() }),
  comment: z.object({
    id: z.number(),
    body: z.string().nullable(),
    user: z.object({ login: z.string() }).nullable(),
    created_at: z.string(),
    author_association: z.string(),
  }),
  repository: z.object({ full_name: z.string() }),
  installation: z.object({ id: z.number() }).optional(),
});

/** Parses an already-verified delivery. Only newly created issue/PR comments produce an event. */
export function parseIssueComment(headers: WebhookHeaders, rawBody: Buffer | string): TicketEvent | null {
  if (headerValue(headers, 'x-github-event') !== 'issue_comment') return null;
  const deliveryId = headerValue(headers, 'x-github-delivery');
  if (!deliveryId) return null;
  let json: unknown;
  try {
    json = JSON.parse(rawBody.toString());
  } catch {
    return null;
  }
  const parsed = IssueCommentPayload.safeParse(json);
  if (!parsed.success || parsed.data.action !== 'created' || !parsed.data.installation) return null;
  const p = parsed.data;
  return {
    provider: 'github',
    deliveryId,
    commentId: String(p.comment.id),
    externalId: String(p.installation?.id),
    repoPath: p.repository.full_name,
    ticketRef: String(p.issue.number),
    ticketKind: p.issue.pull_request !== undefined ? 'pr' : 'issue',
    body: p.comment.body ?? '',
    author: p.comment.user?.login ?? 'ghost',
    authorAssociation: p.comment.author_association,
    createdAt: p.comment.created_at,
  };
}
