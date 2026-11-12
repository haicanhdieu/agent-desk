import { createHmac, timingSafeEqual } from 'node:crypto';
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
import type { FakeStore, StoredComment } from './store';

export const FAKE_SIGNATURE_HEADER = 'x-fake-signature';
export const FAKE_EXTERNAL_ID = 'fake';

const FakeWebhookBody = z.object({
  deliveryId: z.string().min(1),
  commentId: z.string().min(1),
  repoPath: z.string().min(1),
  ticketRef: z.string().min(1),
  ticketKind: z.enum(['issue', 'pr']).optional(),
  body: z.string(),
  author: z.string(),
  authorAssociation: z.string(),
  createdAt: z.string().optional(),
});

function header(headers: WebhookHeaders, name: string): string | undefined {
  const v = headers[name];
  return Array.isArray(v) ? v[0] : v;
}

export function fakeSignature(rawBody: Buffer | string, secret: string): string {
  return createHmac('sha256', secret).update(rawBody).digest('hex');
}

function signatureMatches(rawBody: Buffer | string, provided: string, secret: string): boolean {
  const expected = Buffer.from(fakeSignature(rawBody, secret), 'hex');
  const got = Buffer.from(provided, 'hex');
  return got.length === expected.length && timingSafeEqual(got, expected);
}

export class FakeBoardAdapter implements BoardAdapter {
  constructor(
    private readonly store: FakeStore,
    private readonly clock: Clock,
    private readonly defaultSecret: string = process.env.FAKE_WEBHOOK_SECRET || 'dev',
  ) {}

  async verifyAndParseWebhook(
    headers: WebhookHeaders,
    rawBody: Buffer | string,
    secretLookup: SecretLookup,
  ): Promise<TicketEvent | null | 'bad_signature'> {
    const secret = (await secretLookup()) ?? this.defaultSecret;
    const sig = header(headers, FAKE_SIGNATURE_HEADER);
    if (!sig || !signatureMatches(rawBody, sig, secret)) return 'bad_signature';
    let json: unknown;
    try {
      json = JSON.parse(rawBody.toString());
    } catch {
      return 'bad_signature';
    }
    const parsed = FakeWebhookBody.safeParse(json);
    if (!parsed.success) return null;
    const b = parsed.data;
    return {
      provider: 'fake',
      deliveryId: b.deliveryId,
      commentId: b.commentId,
      externalId: FAKE_EXTERNAL_ID,
      repoPath: b.repoPath,
      ticketRef: b.ticketRef,
      ...(b.ticketKind ? { ticketKind: b.ticketKind } : {}),
      body: b.body,
      author: b.author,
      authorAssociation: b.authorAssociation,
      createdAt: b.createdAt ?? this.clock.now().toISOString(),
    };
  }

  async pollEvents(project: AdapterProject, cursor: PollCursor): Promise<PollResult> {
    const all = (await this.store.listComments()).filter(
      (c) => c.repoPath === project.repoPath && Date.parse(c.createdAt) > Date.parse(cursor.since),
    );
    const since = all.reduce((m, c) => (c.createdAt > m ? c.createdAt : m), cursor.since);
    const tickets = await this.store.listTickets();
    const toEvent = (c: StoredComment): TicketEvent => {
      const t = tickets.find((x) => x.repoPath === c.repoPath && String(x.number) === c.ticketRef);
      return {
        provider: 'fake',
        deliveryId: `poll-${c.id}`,
        commentId: c.id,
        externalId: FAKE_EXTERNAL_ID,
        repoPath: c.repoPath,
        ticketRef: c.ticketRef,
        ...(t ? { ticketKind: t.kind } : {}),
        body: c.body,
        author: c.author,
        authorAssociation: c.authorAssociation,
        createdAt: c.createdAt,
      };
    };
    return { kind: 'events', events: all.map(toEvent), cursor: { since, etag: null } };
  }

  async getTicket(project: AdapterProject, ref: string): Promise<Ticket> {
    const n = Number(ref);
    const t = Number.isInteger(n) ? await this.store.getTicket(project.repoPath, n) : undefined;
    if (!t) throw new Error(`ticket ${ref} not found in ${project.repoPath}`);
    return {
      ref: String(t.number),
      kind: t.kind,
      number: t.number,
      title: t.title,
      url: `http://fake.invalid/${t.repoPath}/${t.kind === 'pr' ? 'pull' : 'issues'}/${t.number}`,
      labels: t.labels,
    };
  }

  comment(project: AdapterProject, ref: string, text: string): Promise<string> {
    return this.store.postBotComment(project.repoPath, ref, text);
  }
}
