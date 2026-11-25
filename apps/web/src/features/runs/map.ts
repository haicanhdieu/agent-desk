import {
  FINAL_RUN_STATUSES,
  type IgnoredEventDto,
  type LinkedTicketDto,
  type PrState,
  type ProjectConnectionDto,
  type RunListItem,
  type RunStatsDto,
} from '@agentdesk/contracts';
import type { TicketKind } from '@/ds/TicketRef';
import { connectionCopy } from '@/mocks/connection';
import type {
  ConnectionStatus,
  ConnectionWarning,
  IgnoredCommand,
  Label,
  RunSummary,
  Ticket,
  TicketGroup,
} from '@/mocks/types';
import { relativeTime, timeLeft } from '../relativeTime';
import type { RunCore } from './queries';
import { toUsageCell } from './usage.map';

const MIN = 60_000;

const pad = (n: number) => String(n).padStart(2, '0');

/** Local "HH:mm". */
export const clockTime = (iso: string): string => {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Local "13 Nov, 09:05". */
export const dateTime = (iso: string): string => {
  const d = new Date(iso);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/** Local "HH:mm" for a time on `now`'s calendar day, otherwise "13 Nov, 09:05". */
const clockOrDateTime = (iso: string, now: Date): string =>
  new Date(iso).toDateString() === now.toDateString() ? clockTime(iso) : dateTime(iso);

/**
 * Compact largest units: "48s", "37m 48s", "30m", "3h 57m", "2d 3h 5m". Zero units are omitted, and seconds
 * are dropped from one hour on.
 */
export const formatDuration = (ms: number): string => {
  const total = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (total < 60) return `${seconds}s`;
  if (total < 3600) return seconds === 0 ? `${minutes}m` : `${minutes}m ${seconds}s`;
  return [
    [days, 'd'],
    [hours, 'h'],
    [minutes, 'm'],
  ]
    .filter(([n]) => n !== 0)
    .map(([n, unit]) => `${n}${unit}`)
    .join(' ');
};

/** Ticket, comment and repo text is untrusted: only http(s) URLs become links; anything else is no link (''). */
export function safeHref(url: string): string {
  if (!/^https?:\/\//i.test(url)) return '';
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : '';
  } catch {
    return '';
  }
}

/** Label colours arrive as 6-digit hex without '#'; anything else gets no swatch. */
const labelColor = (color: string) => (/^[0-9a-f]{6}$/i.test(color) ? `#${color.toLowerCase()}` : '');

export const isFinal = (status: RunCore['status']) => FINAL_RUN_STATUSES.some((s) => s === status);

/** An agent's idle end in whole minutes (the form edits it in minutes). */
const idleEndMinutes = (idleEndSeconds: number): number => Math.round(idleEndSeconds / 60);

function statusNote(dto: RunCore, now: Date): string | undefined {
  switch (dto.status) {
    case 'queued':
      return 'Waiting for a slot';
    case 'idle': {
      if (!dto.idleSince) return undefined;
      const waited = Math.max(0, Math.floor((now.getTime() - Date.parse(dto.idleSince)) / MIN));
      return `Waiting ${waited}m. Auto-finish after ${idleEndMinutes(dto.idleEndSeconds)}m unattended`;
    }
    case 'running':
      return dto.waitingOn === 'background' ? 'Waiting on background work' : undefined;
    case 'done': {
      if (!dto.idleSince) return undefined;
      const ago = Math.max(0, Math.floor((now.getTime() - Date.parse(dto.idleSince)) / MIN));
      return `Done ${ago}m ago. Auto-finish after ${idleEndMinutes(dto.idleEndSeconds)}m unattended`;
    }
    case 'failed':
    case 'timed_out':
      return dto.failureReason ?? undefined;
    case 'paused':
      return dto.sessionExpiresAt ? `Can be resumed for ${timeLeft(dto.sessionExpiresAt, now)}` : 'Can be resumed';
    case 'expired':
      return 'The saved session was deleted';
    default:
      return undefined;
  }
}

/** Final runs: start to finish. Paused runs: start to the pause. Runs still going: start to now. Queued runs: none. */
export function duration(dto: RunCore, now: Date): string | undefined {
  if (!dto.startedAt) return undefined;
  const start = Date.parse(dto.startedAt);
  if (isFinal(dto.status)) return dto.finishedAt ? formatDuration(Date.parse(dto.finishedAt) - start) : undefined;
  if (dto.status === 'paused' && dto.pausedAt) return formatDuration(Date.parse(dto.pausedAt) - start);
  return formatDuration(now.getTime() - start);
}

/** A pending cancel or finish ("Cancelling…") shows instead of the derived note. */
export function toRunSummary(dto: RunCore & { statusNote?: string }, now: Date): RunSummary {
  const login = dto.triggeredBy ?? '—';
  const note = dto.statusNote ?? statusNote(dto, now);
  const time = duration(dto, now);
  const labels: Label[] = dto.ticket.labels.map((l) => ({ name: l.name, color: labelColor(l.color) }));
  return {
    id: dto.number,
    status: dto.status,
    ...(note !== undefined && { statusNote: note }),
    command: dto.command === '' ? '' : `/${dto.command}`,
    skill: dto.skillName ?? 'Custom prompt',
    agent: dto.agent.name,
    model: dto.agent.model,
    ticket: {
      kind: dto.ticket.kind,
      number: dto.ticket.number,
      title: dto.ticket.title,
      labels,
      href: safeHref(dto.ticket.url),
    },
    triggeredBy: { login, bot: login.endsWith('[bot]') },
    startedAt: clockOrDateTime(dto.startedAt ?? dto.queuedAt, now),
    ...(time !== undefined && { duration: time }),
    usage: toUsageCell(dto.usage),
  };
}

/** Identity of a ticket within a project (an issue and a PR can share a number on some hosts). */
export const ticketKey = (t: { kind: string; number: number }): string => `${t.kind}:${t.number}`;

/** Runs each ticket has had, by ticket key, as the server counted them (`ticketRunCount`, all statuses). */
export function ticketRunCounts(items: RunListItem[]): Map<string, number> {
  const used = new Map<string, number>();
  for (const r of items) used.set(ticketKey(r.ticket), r.ticketRunCount);
  return used;
}

/** Each listed run's linked tickets, by run number. */
export function linkedTicketsByRun(items: RunListItem[]): Map<number, LinkedTicketDto[]> {
  return new Map(items.map((r) => [r.number, r.linkedTickets]));
}

/**
 * Group identity: for a PR run, `issue:<n>` of the lowest-numbered issue in its own linked tickets; otherwise the
 * run's own ticket key. Entries of kind pr never decide a group.
 */
export function groupKeyOf(run: Pick<RunSummary, 'ticket'>, linked: readonly LinkedTicketDto[]): string {
  if (run.ticket.kind !== 'pr') return ticketKey(run.ticket);
  const issues = linked.filter((t) => t.kind === 'issue').map((t) => t.number);
  return issues.length > 0 ? ticketKey({ kind: 'issue', number: Math.min(...issues) }) : ticketKey(run.ticket);
}

const kindLabel = (kind: TicketKind) => (kind === 'pr' ? 'PR' : 'Issue');

/** "Issue #142 (1 of 10 runs) → PR #148 (1 of 10 runs), PR #150 (2 of 10 runs)" (linked already in number order). */
export function chainNoteOf(
  lead: { kind: TicketKind; number: number },
  leadUsed: number,
  linked: NonNullable<TicketGroup['linked']>,
  runsMax: number,
): string {
  const part = (t: { kind: TicketKind; number: number }, used: number) =>
    `${kindLabel(t.kind)} #${t.number} (${used} of ${runsMax} runs)`;
  return `${part(lead, leadUsed)} → ${linked.map((l) => part(l.ticket, l.runsUsed)).join(', ')}`;
}

/**
 * One group per ticket, or per issue with its linked PRs; newest run's group first, runs inside a group oldest first.
 * `runsUsed` comes from `used` (`ticketRunCounts`: the server's count of every run the ticket has had) when given,
 * else from the lead's linked entry, else the group's own run count. Counts are per ticket and never summed.
 */
export function groupByTicket(
  runs: RunSummary[],
  maxRunsPerTicket: number,
  used?: ReadonlyMap<string, number>,
  linked?: ReadonlyMap<number, readonly LinkedTicketDto[]>,
): TicketGroup[] {
  const buckets = new Map<string, RunSummary[]>();
  for (const run of runs) {
    const key = groupKeyOf(run, linked?.get(run.id) ?? []);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(run);
    else buckets.set(key, [run]);
  }
  const groups = [...buckets].map(([key, bucket]): TicketGroup => {
    const sorted = [...bucket].sort((a, b) => a.id - b.id);
    const entries = sorted.flatMap((r) => linked?.get(r.id) ?? []);
    const leadRun = sorted.find((r) => ticketKey(r.ticket) === key);
    const leadEntry = entries.find((e) => ticketKey(e) === key);
    const ticket: Ticket | undefined =
      leadRun?.ticket ??
      (leadEntry && {
        kind: leadEntry.kind,
        number: leadEntry.number,
        title: leadEntry.title,
        labels: leadEntry.labels.map((l) => ({ name: l.name, color: labelColor(l.color) })),
        href: safeHref(leadEntry.url),
      });
    // A group is keyed by its lead: a run's own ticket or the lead entry its snapshot carries.
    if (!ticket) throw new Error(`group ${key} has no lead ticket`);
    const leadRows = sorted.filter((r) => ticketKey(r.ticket) === key).length;
    const runsUsed = Math.max(used?.get(key) ?? leadEntry?.ticketRunCount ?? 0, leadRows);
    const prs = new Map<string, { kind: TicketKind; number: number; count: number | undefined }>();
    for (const r of sorted) {
      const k = ticketKey(r.ticket);
      if (k !== key) prs.set(k, { kind: r.ticket.kind, number: r.ticket.number, count: undefined });
    }
    for (const e of entries) {
      const k = ticketKey(e);
      if (e.kind === 'pr' && k !== key) prs.set(k, { kind: 'pr', number: e.number, count: e.ticketRunCount });
    }
    const linkedPrs = [...prs]
      .map(([k, p]) => ({
        ticket: { kind: p.kind, number: p.number },
        runsUsed: Math.max(used?.get(k) ?? p.count ?? 0, sorted.filter((r) => ticketKey(r.ticket) === k).length),
      }))
      .sort((a, b) => a.ticket.number - b.ticket.number);
    return {
      ticket,
      runsUsed,
      runsMax: maxRunsPerTicket,
      runs: sorted,
      ...(linkedPrs.length > 0 && {
        linked: linkedPrs,
        chainNote: chainNoteOf(ticket, runsUsed, linkedPrs, maxRunsPerTicket),
      }),
    };
  });
  const newest = (g: TicketGroup) => Math.max(...g.runs.map((r) => r.id));
  return groups.sort((a, b) => newest(b) - newest(a));
}

const sameLocalDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** Local midnight of `now`'s day as an ISO timestamp: the `since` of `runs.stats`. */
export const startOfLocalDay = (now: Date): string =>
  new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();

/** "Today: 9 runs, 1 failed" from the server's counts of the runs queued today. */
export function todaySummary(today: RunStatsDto['today']): string {
  const { total, failed } = today;
  return `Today: ${total} ${total === 1 ? 'run' : 'runs'}${failed > 0 ? `, ${failed} failed` : ''}`;
}

/** The pinned banner's slot sentence for an idle run. */
export function idleSlotNote(maxConcurrentRuns: number, waiting: number | undefined, idleEndSeconds: number): string {
  const holds = maxConcurrentRuns === 1 ? 'It holds your only slot' : `It holds one of your ${maxConcurrentRuns} slots`;
  const queue = waiting === undefined ? '' : `, so Run ${waiting} is waiting`;
  return `${holds}${queue}. It ends on its own after ${idleEndMinutes(idleEndSeconds)} minutes with nobody attached.`;
}

/** Local "HH:mm" when the idle run ends on its own. */
export const idleEndsAt = (idleSince: string, idleEndSeconds: number): string =>
  clockTime(new Date(Date.parse(idleSince) + idleEndSeconds * 1000).toISOString());

const REASONS: Record<string, string> = {
  ignored_unauthorized: 'Not a collaborator',
  ignored_no_rule: 'No rule for this command',
  ignored_labels: "Ticket labels don't match",
  ignored_target: "Rule doesn't apply to this ticket kind",
  ignored_max_runs: 'Ticket reached its run limit',
  ignored_active_run: 'Same skill already running',
  ignored_rule_disabled: 'Rule is off',
  ignored_no_command: 'Not a command',
};

/**
 * The API stores a parsed command name without the `/` (`code-build`); for a first line that is no command
 * (ignored_no_command) it keeps that line as typed, which is shown as is.
 */
const ignoredCommand = (command: string | null): string => {
  if (command === null) return '—';
  return /^[a-z0-9-]+$/.test(command) ? `/${command}` : command;
};

/**
 * One "Ignored commands" row. The DTO has no comment URL, so the link opens the ticket (`repoUrl` + issues/pull path),
 * or the repository when the ticket is unknown.
 */
export function toIgnored(dto: IgnoredEventDto, repoUrl: string): IgnoredCommand {
  const kind = dto.ticketKind ?? 'issue';
  // The ref is the provider-local ticket number (`160`); an `owner/repo#160` form is read too.
  const match = dto.ticketRef === null ? null : /(?:^|#)(\d+)$/.exec(dto.ticketRef);
  const number = match?.[1] === undefined ? 0 : Number(match[1]);
  return {
    at: clockTime(dto.receivedAt),
    ticket: { kind, number },
    command: ignoredCommand(dto.command),
    author: dto.author ?? '—',
    reason: REASONS[dto.outcome] ?? 'Ignored',
    detail: dto.detail ?? '',
    href: number > 0 ? `${repoUrl}/${kind === 'pr' ? 'pull' : 'issues'}/${number}` : repoUrl,
  };
}

/** The repository's web URL from `owner/name`. */
export const repoUrlOf = (repoPath: string): string =>
  `https://github.com/${repoPath.split('/').map(encodeURIComponent).join('/')}`;

/** "since 11:42" today, else "since yesterday" / "since 10 Nov". */
const since = (iso: string, now: Date) => (sameLocalDay(new Date(iso), now) ? clockTime(iso) : relativeTime(iso, now));

/**
 * The banner above the runs list when commands may be missed: a silent webhook (status tone `warn`) or failing
 * polling (`err`). Healthy connections give none. Actions without an `href` are wired by the route (re-check).
 * `agentHref` is the Desk agent page; without it (the caller may not open the Desk, issue 216) the actions that link
 * there are left out.
 */
export function toConnectionWarning(
  status: ConnectionStatus,
  dto: ProjectConnectionDto,
  agentHref: string | undefined,
  now: Date,
): ConnectionWarning | undefined {
  if (status.tone === 'ok') return undefined;
  const details = agentHref
    ? [{ label: connectionCopy.connectionDetails, href: `${agentHref}?tab=github`, variant: 'ghost' as const }]
    : [];
  if (status.mode === 'webhook') {
    const last = dto.webhook?.lastEventAt;
    return {
      tone: 'err',
      icon: 'warning',
      title: last ? `No webhooks from GitHub since ${since(last, now)}` : 'No webhooks from GitHub yet',
      body: 'Comments posted since then have not started runs. Start the webhook relay and redeliver missed events from the app settings in GitHub, or switch this project to polling, which needs no public URL.',
      actions: [
        ...(agentHref
          ? [{ label: connectionCopy.switchToPolling, href: `${agentHref}?tab=github`, variant: 'primary' as const }]
          : []),
        { label: connectionCopy.checkAgain, icon: 'refresh' as const },
        ...details,
      ],
    };
  }
  const lastChecked = dto.polling?.lastCheckedAt;
  const revoked = dto.polling?.pausedReason === 'token_revoked';
  return {
    tone: 'err',
    icon: 'warning',
    title: status.text,
    body: [
      lastChecked ? `The last good check was at ${since(lastChecked, now)}.` : '',
      connectionCopy.pollingFailedBody,
      revoked ? 'Reinstall the GitHub App or give it access to this repository again.' : '',
    ]
      .filter(Boolean)
      .join(' '),
    actions: [{ label: connectionCopy.retryNow, icon: 'refresh' as const }, ...details],
  };
}

/** Ticket numbers of the PR tickets among `tickets`, as refs; issues are never asked. */
export function prRefsOf(tickets: Iterable<{ kind: TicketKind; number: number }>): string[] {
  const refs: string[] = [];
  for (const t of tickets) if (t.kind === 'pr') refs.push(String(t.number));
  return refs;
}

/** `prState` set when the ticket is a PR with a known state; issues and unknown refs come back unchanged. */
export function withPrState<T extends { kind: TicketKind; number: number }>(
  ticket: T,
  states: ReadonlyMap<string, PrState>,
): T & { prState?: PrState } {
  if (ticket.kind !== 'pr') return ticket;
  const prState = states.get(String(ticket.number));
  return prState === undefined ? ticket : { ...ticket, prState };
}

/** Each group's header ticket and every row's ticket through withPrState; chainNote and everything else unchanged. */
export function withPrStates(groups: TicketGroup[], states: ReadonlyMap<string, PrState>): TicketGroup[] {
  return groups.map((g) => ({
    ...g,
    ticket: withPrState(g.ticket, states),
    runs: g.runs.map((r) => ({ ...r, ticket: withPrState(r.ticket, states) })),
  }));
}
