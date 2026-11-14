import {
  FINAL_RUN_STATUSES,
  type IgnoredEventDto,
  type ProjectConnectionDto,
  type RunDto,
  type RunListFilter,
} from '@agentdesk/contracts';
import { connectionCopy } from '@/mocks/connection';
import type {
  ConnectionStatus,
  ConnectionWarning,
  IgnoredCommand,
  Label,
  RunSummary,
  TicketGroup,
} from '@/mocks/types';
import { IDLE_END_MINUTES } from '../desk/agent.form';
import { relativeTime } from '../relativeTime';
import type { CachedRun } from './queries';

const MIN = 60_000;

const pad = (n: number) => String(n).padStart(2, '0');

/** Local "HH:mm". */
export const clockTime = (iso: string): string => {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/** "12m 04s". */
export const formatDuration = (ms: number): string => {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}m ${pad(total % 60)}s`;
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

export const isFinal = (status: RunDto['status']) => FINAL_RUN_STATUSES.some((s) => s === status);

function statusNote(dto: RunDto, now: Date): string | undefined {
  switch (dto.status) {
    case 'queued':
      return 'Waiting for a slot';
    case 'idle': {
      if (!dto.idleSince) return undefined;
      const waited = Math.max(0, Math.floor((now.getTime() - Date.parse(dto.idleSince)) / MIN));
      return `Waiting ${waited}m. Auto-finish after ${IDLE_END_MINUTES}m unattended`;
    }
    case 'running':
      return dto.waitingOn === 'background' ? 'Waiting on background work' : undefined;
    case 'done': {
      if (!dto.idleSince) return undefined;
      const ago = Math.max(0, Math.floor((now.getTime() - Date.parse(dto.idleSince)) / MIN));
      return `Done ${ago}m ago. Auto-finish after ${IDLE_END_MINUTES}m unattended`;
    }
    case 'failed':
    case 'timed_out':
      return dto.failureReason ?? undefined;
    default:
      return undefined;
  }
}

/** Final runs: start to finish. Runs still going: start to now. Queued runs: none. */
export function duration(dto: RunDto, now: Date): string | undefined {
  if (!dto.startedAt) return undefined;
  const start = Date.parse(dto.startedAt);
  if (isFinal(dto.status)) return dto.finishedAt ? formatDuration(Date.parse(dto.finishedAt) - start) : undefined;
  return formatDuration(now.getTime() - start);
}

/** A pending cancel or finish ("Cancelling…") shows instead of the derived note. */
export function toRunSummary(dto: CachedRun, now: Date): RunSummary {
  const login = dto.triggeredBy ?? '—';
  const note = dto.statusNote ?? statusNote(dto, now);
  const time = duration(dto, now);
  const labels: Label[] = dto.ticket.labels.map((l) => ({ name: l.name, color: labelColor(l.color) }));
  return {
    id: dto.number,
    status: dto.status,
    ...(note !== undefined && { statusNote: note }),
    command: `/${dto.command}`,
    skill: dto.skillName,
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
    startedAt: clockTime(dto.startedAt ?? dto.queuedAt),
    ...(time !== undefined && { duration: time }),
  };
}

/** Identity of a ticket within a project (an issue and a PR can share a number on some hosts). */
export const ticketKey = (t: { kind: string; number: number }): string => `${t.kind}:${t.number}`;

/** Runs per ticket over a run list (pass the unfiltered list so filters don't shrink "N of max runs"). */
export function runsPerTicket(runs: RunDto[]): Map<string, number> {
  const used = new Map<string, number>();
  for (const r of runs) used.set(ticketKey(r.ticket), (used.get(ticketKey(r.ticket)) ?? 0) + 1);
  return used;
}

/**
 * One group per ticket, newest run's group first; runs inside a group oldest first. `runsUsed` comes from `used`
 * (runs per ticket over the unfiltered list) when given, else the group's own run count.
 */
export function groupByTicket(
  runs: RunSummary[],
  maxRunsPerTicket: number,
  used?: ReadonlyMap<string, number>,
): TicketGroup[] {
  const groups = new Map<string, TicketGroup>();
  for (const run of runs) {
    const key = ticketKey(run.ticket);
    const group = groups.get(key);
    if (group) group.runs.push(run);
    else groups.set(key, { ticket: run.ticket, runsUsed: 0, runsMax: maxRunsPerTicket, runs: [run] });
  }
  const newest = (g: TicketGroup) => Math.max(...g.runs.map((r) => r.id));
  return [...groups.values()]
    .map((g) => ({
      ...g,
      runs: [...g.runs].sort((a, b) => a.id - b.id),
      runsUsed: Math.max(used?.get(ticketKey(g.ticket)) ?? 0, g.runs.length),
    }))
    .sort((a, b) => newest(b) - newest(a));
}

/**
 * Chip counts: needs-you, active and queued from the project's server-side counts (uncapped); ended and all from the
 * unfiltered run list. `active` follows the API filter (starting, running and idle), which is what `counts.running`
 * counts.
 */
export function chipCounts(
  counts: { needsYou: number; running: number; queued: number },
  all: RunDto[],
): Record<RunListFilter, number> {
  return {
    needs_you: counts.needsYou,
    active: counts.running,
    queued: counts.queued,
    ended: all.filter((r) => isFinal(r.status)).length,
    all: all.length,
  };
}

const sameLocalDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** "Today: 9 runs, 1 failed" over the runs queued today (local day). */
export function todaySummary(runs: RunDto[], now: Date): string {
  const today = runs.filter((r) => sameLocalDay(new Date(r.queuedAt), now));
  const failed = today.filter((r) => r.status === 'failed').length;
  const n = today.length;
  return `Today: ${n} ${n === 1 ? 'run' : 'runs'}${failed > 0 ? `, ${failed} failed` : ''}`;
}

/** The pinned banner's slot sentence for an idle run. */
export function idleSlotNote(maxConcurrentRuns: number, waiting: number | undefined): string {
  const holds = maxConcurrentRuns === 1 ? 'It holds your only slot' : `It holds one of your ${maxConcurrentRuns} slots`;
  const queue = waiting === undefined ? '' : `, so Run ${waiting} is waiting`;
  return `${holds}${queue}. It ends on its own after ${IDLE_END_MINUTES} minutes with nobody attached.`;
}

/** Local "HH:mm" when the idle run ends on its own. */
export const idleEndsAt = (idleSince: string): string =>
  clockTime(new Date(Date.parse(idleSince) + IDLE_END_MINUTES * MIN).toISOString());

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
 */
export function toConnectionWarning(
  status: ConnectionStatus,
  dto: ProjectConnectionDto,
  agentHref: string,
  now: Date,
): ConnectionWarning | undefined {
  if (status.tone === 'ok') return undefined;
  const details = { label: connectionCopy.connectionDetails, href: agentHref, variant: 'ghost' as const };
  if (status.mode === 'webhook') {
    const last = dto.webhook?.lastEventAt;
    return {
      tone: 'err',
      icon: 'warning',
      title: last ? `No webhooks from GitHub since ${since(last, now)}` : 'No webhooks from GitHub yet',
      body: 'Comments posted since then have not started runs. Start the webhook relay and redeliver missed events from the app settings in GitHub, or switch this project to polling, which needs no public URL.',
      actions: [
        { label: connectionCopy.switchToPolling, href: agentHref, variant: 'primary' },
        { label: connectionCopy.checkAgain, icon: 'refresh' },
        details,
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
    actions: [{ label: connectionCopy.retryNow, icon: 'refresh' }, details],
  };
}
