import { and, eq, isNotNull, isNull, or, sql, type SQL } from 'drizzle-orm';
import { runs, type Tx } from '@agentdesk/db';
import { can } from '@agentdesk/contracts';
import type { TicketEvent } from '../adapters/types';
import { loadAccess } from './load-access';
import { findLinkedUser } from './linked-user';

export type RunOwner =
  | { kind: 'owner'; userId: string; originRunId: string | null }
  | { kind: 'ignored'; outcome: 'ignored_owner_unlinked' | 'ignored_owner_not_permitted'; detail: string };

export interface RunOwnerInput {
  projectId: string;
  boardProvider: string;
  event: Pick<TicketEvent, 'author' | 'authorId' | 'ticketRef' | 'createdAt'>;
  botLogin: string;
}

const unlinked = (detail: string): RunOwner => ({ kind: 'ignored', outcome: 'ignored_owner_unlinked', detail });

/** ISO-8601 instant with an explicit zone. Date.parse alone accepts forms Postgres rejects (22007), which would abort the caller's tx. */
const ISO_INSTANT = /^(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/;

/**
 * True when the date part names a real calendar day. Date.parse rolls 2026-02-30 over to 2 March while Postgres rejects it
 * (22007). Date.UTC only does calendar arithmetic on the comment's own fields here; it is not a clock.
 */
function isRealInstant(createdAt: string): boolean {
  const m = ISO_INSTANT.exec(createdAt);
  if (!m || Number.isNaN(Date.parse(createdAt))) return false;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth;
}

interface Candidate {
  id: string;
  ownerUserId: string | null;
}

/**
 * Runs of the project whose pod could have written a comment made at `createdAt`: started_at <= createdAt and
 * (finished_at is null or createdAt <= finished_at). Both bounds are inclusive. The comment time is compared in SQL as a
 * bound parameter, so the string keeps its full precision. At most two rows: one is a match, two is ambiguous.
 */
async function activeRuns(tx: Tx, projectId: string, createdAt: string, ticketRef?: string): Promise<Candidate[]> {
  const at = sql`${createdAt}::timestamptz`;
  const conditions: (SQL | undefined)[] = [
    eq(runs.projectId, projectId),
    isNotNull(runs.startedAt),
    sql`${runs.startedAt} <= ${at}`,
    or(isNull(runs.finishedAt), sql`${at} <= ${runs.finishedAt}`),
    ticketRef === undefined ? undefined : eq(runs.ticketRef, ticketRef),
  ];
  return tx
    .select({ id: runs.id, ownerUserId: runs.ownerUserId })
    .from(runs)
    .where(and(...conditions))
    .limit(2);
}

/** Origin of a bot comment: the single candidate on the ticket, else the single one in the project; null when none or several. */
async function findOrigin(tx: Tx, projectId: string, event: RunOwnerInput['event']): Promise<Candidate | null> {
  if (!isRealInstant(event.createdAt)) return null;
  const onTicket = await activeRuns(tx, projectId, event.createdAt, event.ticketRef);
  if (onTicket.length > 1) return null;
  if (onTicket.length === 1) return onTicket[0] ?? null;
  const inProject = await activeRuns(tx, projectId, event.createdAt);
  return inProject.length === 1 ? (inProject[0] ?? null) : null;
}

/**
 * Who a run started by this trigger comment belongs to, and whether they may start it.
 * Human: findLinkedUser(boardProvider, authorId). Bot (author === botLogin): the owner of the single originating run of
 * this project (see findOrigin); zero or several, or an origin without an owner, is unlinked. Then the owner must hold
 * run:create at projectId, else not permitted. Every failure is an ignored outcome (fail closed). Runs inside the
 * caller's withOrg tx; all values are bound parameters.
 */
export async function resolveRunOwner(tx: Tx, input: RunOwnerInput): Promise<RunOwner> {
  const { projectId, boardProvider, event, botLogin } = input;
  let userId: string | null;
  let originRunId: string | null = null;

  if (botLogin !== '' && event.author === botLogin) {
    const origin = await findOrigin(tx, projectId, event);
    if (!origin) return unlinked('bot comment has no single originating run');
    if (!origin.ownerUserId) return unlinked('originating run has no owner');
    userId = origin.ownerUserId;
    originRunId = origin.id;
  } else {
    if (!event.authorId) return unlinked('commenter has no provider user id');
    userId = await findLinkedUser(tx, boardProvider, event.authorId);
    if (!userId) return unlinked('commenter is not linked to an Agent Desk user');
  }

  const access = await loadAccess(tx, userId);
  if (!can(access, 'run:create', { projectId })) {
    return {
      kind: 'ignored',
      outcome: 'ignored_owner_not_permitted',
      detail: 'owner does not hold run:create on the project',
    };
  }
  return { kind: 'owner', userId, originRunId };
}

/**
 * Fields for the intake log line that records the owner decision: the origin (a human commenter or the desk's own bot),
 * the outcome and, when decided, the owner and origin run ids. Ids and fixed labels only: no ticket or comment text, no
 * commenter login, no provider payload.
 */
export function runOwnerLogFields(
  owner: RunOwner,
  event: Pick<TicketEvent, 'author'>,
  botLogin: string,
): { origin: 'human' | 'bot'; outcome: string; ownerUserId?: string; originRunId?: string } {
  const origin = botLogin !== '' && event.author === botLogin ? 'bot' : 'human';
  if (owner.kind === 'ignored') return { origin, outcome: owner.outcome };
  return {
    origin,
    outcome: 'owner',
    ownerUserId: owner.userId,
    ...(owner.originRunId === null ? {} : { originRunId: owner.originRunId }),
  };
}
