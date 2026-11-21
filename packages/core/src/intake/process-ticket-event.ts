import { and, eq, ne, notInArray, sql } from 'drizzle-orm';
import {
  agents,
  connections,
  inboundEvents,
  projects,
  resolveProject,
  rules,
  runs,
  withOrg,
  type Db,
  type Tx,
} from '@agentdesk/db';
import { Provider, RuleTarget } from '@agentdesk/contracts';
import type { Clock } from '../clock';
import { parseCommand } from '../router/parse-command';
import { isAuthorizedAuthor, routeEvent, type RuleRow } from '../router/route-event';
import type { AdapterProject, AdapterRegistry, Ticket, TicketEvent } from '../adapters/types';
import { toAdapterProject } from '../adapters/project';
import { normalizeLinkedRefs } from '../adapters/linked-refs';
import { resolveRunOwner, runOwnerLogFields } from '../access/run-owner';
import { isUniqueViolation } from './pg-errors';
import type { IntakeLogger } from './start-run';

export type IntakeChannel = 'webhook' | 'poll';

export interface IntakeDeps {
  db: Db;
  registry: AdapterRegistry;
  /** Called after the run row is committed. Must not throw for ordinary Temporal failures (see startRunWorkflow). */
  startRun: (orgId: string, runId: string) => Promise<void>;
  clock: Clock;
  /** Login the desk comments as; its own comments may trigger chains. */
  botLogin: string;
  log?: IntakeLogger;
  /** Bound on one board ticket fetch (default 5 s); a timeout counts as "ticket unavailable". */
  ticketTimeoutMs?: number;
}

/**
 * Posted on the ticket when a bot-authored trigger cannot be given an owner. Fixed text: no ticket, comment, command or
 * author text, and its first line is not a command, so it can never start a run when it comes back as a comment.
 */
export const OWNER_UNDETECTED_NOTICE =
  "Agent Desk did not start this command: it could not work out which person's run posted the comment, so there is no owner to start it as. Post the command again yourself to start it.";

/** Where to post `OWNER_UNDETECTED_NOTICE`, decided inside the intake transaction and posted after it commits. */
interface OwnerNotice {
  provider: Provider;
  project: AdapterProject;
  ticketRef: string;
}

type Routed = IntakeResult & { notice?: OwnerNotice };

export interface IntakeResult {
  /** `run_created`, `duplicate`, `duplicate_comment`, `ignored_*`. */
  outcome: string;
  runId?: string;
}

const FINAL_STATUSES = ['succeeded', 'failed', 'cancelled', 'timed_out'];
/** Unique constraint on runs (project_id, trigger_comment_id). */
const RUN_COMMENT_UNIQUE = 'runs_project_trigger_comment_key';
const MAX_COMMAND_COLUMN = 100;
const TICKET_TIMEOUT_MS = 5000;

/** The board did not answer a ticket fetch in time. */
export class TicketFetchTimeoutError extends Error {
  override readonly name = 'TicketFetchTimeoutError';
  constructor() {
    super('ticket fetch timed out');
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TicketFetchTimeoutError()), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

/** A ticket fetched before the routing transaction: the ticket, or the error the fetch failed with. */
type Prefetched = { ok: true; ticket: Ticket } | { ok: false; err: unknown };

/** The command column of an inbound row: the parsed command, else the (truncated) first line that failed to parse. */
function commandColumn(body: string): string | null {
  const parsed = parseCommand(body);
  if (parsed) return parsed.command;
  const first = (body.split(/\r|\n/, 1)[0] ?? '').trim();
  return first === '' ? null : first.slice(0, MAX_COMMAND_COLUMN);
}

/**
 * Steps 2-6 of control-plane design 6.1, shared by the webhook and polling channels.
 *
 * The project is resolved first so the delivery row can carry its org: rows with a null org are insert-only for the
 * app role (never updatable, never readable), so an unresolvable delivery is inserted once with its final outcome and
 * a resolvable one is inserted as `received` and finalised inside the same org transaction that routes it. The
 * `(provider, delivery_id)` unique key is global, so a replay is `duplicate` whichever org (or none) owns the row.
 * `startRun` runs only after that transaction commits.
 */
export async function processTicketEvent(
  deps: IntakeDeps,
  event: TicketEvent,
  channel: IntakeChannel,
  known?: { orgId: string; projectId: string },
): Promise<IntakeResult> {
  const target = known ?? (await resolveProject(deps.db, event.provider, event.externalId, event.repoPath));
  if (!target) return recordUnknownProject(deps, event, channel);

  const prefetched = await prefetchTicket(deps, event, target);
  const routed = await withOrg(deps.db, target.orgId, (tx) => routeInTx(deps, tx, event, channel, target, prefetched));
  if (routed.notice) await postOwnerNotice(deps, routed.notice);
  const result: IntakeResult = {
    outcome: routed.outcome,
    ...(routed.runId !== undefined ? { runId: routed.runId } : {}),
  };
  if (result.outcome === 'run_created' && result.runId !== undefined) {
    await deps.startRun(target.orgId, result.runId);
  }
  return result;
}

/** Best effort: a failed or slow post is logged by error name and never changes the intake outcome. */
async function postOwnerNotice(deps: IntakeDeps, notice: OwnerNotice): Promise<void> {
  try {
    await withTimeout(
      deps.registry.board(notice.provider).comment(notice.project, notice.ticketRef, OWNER_UNDETECTED_NOTICE),
      deps.ticketTimeoutMs ?? TICKET_TIMEOUT_MS,
    );
  } catch (err) {
    deps.log?.warn({ err: err instanceof Error ? err.name : 'unknown' }, 'owner notice not posted');
  }
}

/**
 * Fetches the ticket before the routing transaction opens, so the provider call never holds a pool connection or the
 * per-comment advisory lock. Only for events that look runnable (a command from an authorized author, an enabled rule
 * for it, a new delivery, an owner who may start it and no run for the comment yet), read in a short transaction of their own; anything else
 * returns undefined and is decided in the routing transaction as before, which then fetches lazily (still bounded) in
 * the rare case a concurrent change made it runnable. The fetch is bounded by `ticketTimeoutMs`.
 */
async function prefetchTicket(
  deps: IntakeDeps,
  event: TicketEvent,
  target: { orgId: string; projectId: string },
): Promise<Prefetched | undefined> {
  const parsed = parseCommand(event.body);
  if (!parsed || !isAuthorizedAuthor(event, deps.botLogin)) return undefined;
  const { projectId } = target;
  const pre = await withOrg(deps.db, target.orgId, async (tx) => {
    const [delivery] = await tx
      .select({ id: inboundEvents.id })
      .from(inboundEvents)
      .where(and(eq(inboundEvents.provider, event.provider), eq(inboundEvents.deliveryId, event.deliveryId)))
      .limit(1);
    if (delivery) return undefined;
    const [sameComment] = await tx
      .select({ id: runs.id })
      .from(runs)
      .where(and(eq(runs.projectId, projectId), eq(runs.triggerCommentId, event.commentId)))
      .limit(1);
    if (sameComment) return undefined;
    const [rule] = await tx
      .select({ enabled: rules.enabled })
      .from(rules)
      .where(and(eq(rules.projectId, projectId), eq(rules.command, parsed.command)))
      .limit(1);
    if (!rule?.enabled) return undefined;
    const [proj] = await tx
      .select({
        repoPath: projects.repoPath,
        defaultBranch: projects.defaultBranch,
        boardProvider: connections.provider,
        boardExternalId: connections.externalId,
      })
      .from(projects)
      .innerJoin(connections, eq(connections.id, projects.boardConnectionId))
      .where(eq(projects.id, projectId))
      .limit(1);
    if (!proj) return undefined;
    // The desk's own bot is trusted to cause a fetch: its owner comes from the PR's links, which need the ticket.
    if (event.author === deps.botLogin) return proj;
    // A comment whose owner would be refused is never fetched for: an untrusted commenter cannot make the desk call the board.
    const owner = await resolveRunOwner(tx, {
      projectId,
      boardProvider: proj.boardProvider,
      event,
      botLogin: deps.botLogin,
    });
    return owner.kind === 'owner' ? proj : undefined;
  });
  if (!pre) return undefined;
  const provider = Provider.safeParse(pre.boardProvider);
  if (!provider.success) return undefined;
  const board = deps.registry.board(provider.data);
  try {
    const ticket = await withTimeout(
      board.getTicket(toAdapterProject(pre, pre.boardExternalId), event.ticketRef),
      deps.ticketTimeoutMs ?? TICKET_TIMEOUT_MS,
    );
    return { ok: true, ticket };
  } catch (err) {
    return { ok: false, err };
  }
}

/** The issue refs a PR links to, for a bot comment's owner lookup; [] for an issue, or when the ticket is unavailable. */
async function linkedIssueRefsOf(fetchTicket: () => Promise<Ticket>, log: IntakeLogger | undefined): Promise<string[]> {
  try {
    const ticket = await fetchTicket();
    return ticket.kind === 'pr' ? normalizeLinkedRefs(ticket.linkedRefs) : [];
  } catch (err) {
    log?.warn({ err: err instanceof Error ? err.name : 'unknown' }, 'ticket unavailable for owner lookup');
    return [];
  }
}

async function recordUnknownProject(
  deps: IntakeDeps,
  event: TicketEvent,
  channel: IntakeChannel,
): Promise<IntakeResult> {
  // One insert with the final values and no RETURNING: the row is invisible to every tenant afterwards.
  const res = await deps.db.orm
    .insert(inboundEvents)
    .values({
      provider: event.provider,
      channel,
      deliveryId: event.deliveryId,
      commentId: event.commentId,
      outcome: 'ignored_unknown_project',
      ticketRef: event.ticketRef,
      author: event.author,
      command: commandColumn(event.body),
      detail: 'no project matches this connection and repository',
      receivedAt: deps.clock.now(),
    })
    .onConflictDoNothing();
  return { outcome: res.rowCount === 0 ? 'duplicate' : 'ignored_unknown_project' };
}

async function routeInTx(
  deps: IntakeDeps,
  tx: Tx,
  event: TicketEvent,
  channel: IntakeChannel,
  target: { orgId: string; projectId: string },
  prefetched: Prefetched | undefined,
): Promise<Routed> {
  const { orgId, projectId } = target;
  const [inserted] = await tx
    .insert(inboundEvents)
    .values({
      provider: event.provider,
      channel,
      deliveryId: event.deliveryId,
      commentId: event.commentId,
      orgId,
      projectId,
      outcome: 'received',
      ticketRef: event.ticketRef,
      author: event.author,
      command: commandColumn(event.body),
      receivedAt: deps.clock.now(),
    })
    .onConflictDoNothing()
    .returning({ id: inboundEvents.id });
  if (!inserted) return { outcome: 'duplicate' };
  const inboundId = inserted.id;
  try {
    // A savepoint: a routing failure must not take the already-written delivery row down with it.
    return await tx.transaction((sp) => decideInTx(deps, sp, event, channel, target, inboundId, prefetched));
  } catch (err) {
    const name = err instanceof Error ? err.name : 'UnknownError';
    deps.log?.warn({ deliveryId: event.deliveryId, projectId, err: name }, 'intake routing failed');
    // Error name only: messages can echo row values or provider payloads.
    await tx.update(inboundEvents).set({ outcome: 'error', detail: name }).where(eq(inboundEvents.id, inboundId));
    return { outcome: 'error' };
  }
}

async function decideInTx(
  deps: IntakeDeps,
  tx: Tx,
  event: TicketEvent,
  channel: IntakeChannel,
  target: { orgId: string; projectId: string },
  inboundId: string,
  prefetched: Prefetched | undefined,
): Promise<Routed> {
  const { orgId, projectId } = target;
  const finish = async (outcome: string, detail: string | null = null): Promise<IntakeResult> => {
    await tx.update(inboundEvents).set({ outcome, detail }).where(eq(inboundEvents.id, inboundId));
    return { outcome };
  };

  // Serialise deliveries of the same comment: the loser waits here until the winner commits, then sees its run below
  // (otherwise its guards could see the winner's fresh run first and report ignored_active_run).
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${projectId}:${event.commentId}`}, 0))`);

  // The same comment may arrive through both channels under different delivery ids.
  const [sameComment] = await tx
    .select({ id: runs.id })
    .from(runs)
    .where(and(eq(runs.projectId, projectId), eq(runs.triggerCommentId, event.commentId)))
    .limit(1);
  if (sameComment) return finish('duplicate_comment', 'a run already exists for this comment');

  const [proj] = await tx
    .select({
      repoPath: projects.repoPath,
      defaultBranch: projects.defaultBranch,
      maxRunsPerTicket: projects.maxRunsPerTicket,
      boardProvider: connections.provider,
      boardExternalId: connections.externalId,
    })
    .from(projects)
    .innerJoin(connections, eq(connections.id, projects.boardConnectionId))
    .where(eq(projects.id, projectId))
    .limit(1);
  if (!proj) return finish('ignored_unknown_project', 'project no longer exists');

  const provider = Provider.parse(proj.boardProvider);
  const board = deps.registry.board(provider);
  const adapterProject = toAdapterProject(proj, proj.boardExternalId);
  /** The prefetched ticket (or its failure); a lazy, bounded fetch only when nothing was prefetched. */
  let fetched: Promise<Ticket> | undefined;
  const fetchTicket = (): Promise<Ticket> =>
    (fetched ??= prefetched
      ? prefetched.ok
        ? Promise.resolve(prefetched.ticket)
        : Promise.reject(prefetched.err)
      : withTimeout(board.getTicket(adapterProject, event.ticketRef), deps.ticketTimeoutMs ?? TICKET_TIMEOUT_MS));

  const ruleRows = await tx.select().from(rules).where(eq(rules.projectId, projectId));
  const ruleList: RuleRow[] = ruleRows.map((r) => ({
    id: r.id,
    command: r.command,
    labelFilter: r.labelFilter,
    target: RuleTarget.parse(r.target),
    agentId: r.agentId,
    model: r.model,
    skillName: r.skillName,
    prompt: r.prompt,
    enabled: r.enabled,
  }));

  const onTicket = and(eq(runs.projectId, projectId), eq(runs.ticketRef, event.ticketRef));
  const [counted] = await tx
    .select({ total: sql<number>`count(*)::int` })
    .from(runs)
    .where(onTicket);
  const active = await tx
    .select({ skillName: runs.skillName, ruleId: runs.ruleId })
    .from(runs)
    .where(and(onTicket, notInArray(runs.status, FINAL_STATUSES)));

  const decision = await routeEvent({
    event,
    project: { id: projectId, maxRunsPerTicket: proj.maxRunsPerTicket },
    rules: ruleList,
    ticket: fetchTicket,
    counts: {
      runsForTicket: counted?.total ?? 0,
      activeSkillsOnTicket: [...new Set(active.flatMap((a) => (a.skillName === null ? [] : [a.skillName])))],
      activeRuleIdsOnTicket: [...new Set(active.flatMap((a) => (a.ruleId === null ? [] : [a.ruleId])))],
    },
    botLogin: deps.botLogin,
    // The owner is the linked commenter (or, for the bot, the origin run's owner) and must hold run:create here.
    owner: async () => {
      const owner = await resolveRunOwner(tx, {
        projectId,
        boardProvider: proj.boardProvider,
        event,
        botLogin: deps.botLogin,
        ...(event.author === deps.botLogin ? { linkedIssueRefs: await linkedIssueRefsOf(fetchTicket, deps.log) } : {}),
      });
      deps.log?.info?.(
        { deliveryId: event.deliveryId, projectId, channel, ...runOwnerLogFields(owner, event, deps.botLogin) },
        'intake run owner decided',
      );
      return owner.kind === 'owner'
        ? { kind: 'ok', userId: owner.userId, originRunId: owner.originRunId }
        : { kind: 'ignored', outcome: owner.outcome, detail: owner.detail };
    },
  });
  if (decision.kind === 'ignored') {
    const result = await finish(decision.outcome, decision.detail);
    if (decision.outcome !== 'ignored_owner_unlinked' || event.author !== deps.botLogin) return result;
    // Once per trigger comment: the same comment can come through both channels, and each delivery is routed.
    const [earlier] = await tx
      .select({ id: inboundEvents.id })
      .from(inboundEvents)
      .where(
        and(
          eq(inboundEvents.projectId, projectId),
          // A comment belongs to one ticket; these two predicates let the planner use the partial
          // inbound_events_project_ticket_ref_ignored_idx instead of scanning the project's events.
          eq(inboundEvents.ticketRef, event.ticketRef),
          sql`starts_with(${inboundEvents.outcome}, 'ignored_')`,
          eq(inboundEvents.commentId, event.commentId),
          eq(inboundEvents.outcome, 'ignored_owner_unlinked'),
          ne(inboundEvents.id, inboundId),
        ),
      )
      .limit(1);
    if (earlier) return result;
    return { ...result, notice: { provider, project: adapterProject, ticketRef: event.ticketRef } };
  }

  // The router fetches the ticket only when it needs it; the run's snapshot columns always want it.
  let ticket: Ticket | null = decision.ticket;
  if (!ticket) {
    try {
      ticket = await fetchTicket();
    } catch (err) {
      deps.log?.warn({ err: err instanceof Error ? err.name : 'unknown' }, 'ticket snapshot unavailable');
    }
  }
  const kind = ticket?.kind ?? event.ticketKind;
  if (!kind) return finish('ignored_target', 'ticket kind unknown');
  const refNumber = Number(event.ticketRef);
  const number = ticket?.number ?? (Number.isInteger(refNumber) ? refNumber : undefined);
  if (number === undefined && kind === 'pr') return finish('ignored_target', 'pull request number unknown');
  const checkoutRef = deps.registry.codeHost(provider).checkoutRef({
    kind,
    number: number ?? 0,
    ...(proj.defaultBranch !== null ? { defaultBranch: proj.defaultBranch } : {}),
  });

  // Freeze the model on the run: the rule's own, else the agent's default as it is now.
  let runModel = decision.rule.model;
  if (runModel === null) {
    const [agent] = await tx
      .select({ model: agents.model })
      .from(agents)
      .where(and(eq(agents.id, decision.rule.agentId), eq(agents.projectId, projectId)))
      .limit(1);
    runModel = agent?.model ?? null;
  }

  try {
    // A savepoint: a unique violation must not abort the surrounding transaction.
    const run = await tx.transaction(async (sp) => {
      const [row] = await sp
        .insert(runs)
        .values({
          orgId,
          projectId,
          ruleId: decision.rule.id,
          agentId: decision.rule.agentId,
          model: runModel,
          command: decision.command,
          skillName: decision.rule.skillName,
          prompt: decision.rule.prompt,
          ticketRef: event.ticketRef,
          ticketKind: kind,
          ticketNumber: number ?? null,
          ticketTitle: ticket?.title ?? null,
          ticketUrl: ticket?.url ?? null,
          ticketLabels: ticket?.labels ?? [],
          linkedIssueRefs: kind === 'pr' ? normalizeLinkedRefs(ticket?.linkedRefs ?? []) : [],
          checkoutRef,
          args: decision.args === '' ? null : decision.args,
          status: 'queued',
          triggerSource: channel === 'webhook' ? 'webhook' : 'polling',
          triggerCommentId: event.commentId,
          inboundEventId: inboundId,
          triggeredBy: event.author,
          triggeredByExternalId: event.authorId ?? null,
          ownerUserId: decision.owner.userId,
          originRunId: decision.owner.originRunId,
        })
        .returning({ id: runs.id });
      return row;
    });
    if (!run) throw new Error('run insert returned no row');
    await tx.update(inboundEvents).set({ outcome: 'run_created' }).where(eq(inboundEvents.id, inboundId));
    return { outcome: 'run_created', runId: run.id };
  } catch (err) {
    if (!isUniqueViolation(err, RUN_COMMENT_UNIQUE)) throw err;
    return finish('duplicate_comment', 'a run already exists for this comment');
  }
}
