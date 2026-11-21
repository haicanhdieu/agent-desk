import type { IgnoredEventDto, LinkedTicketDto, RunDto, RunListItem } from '@agentdesk/contracts';
import { describe, expect, it } from 'vitest';
import { runFixtures } from '@/mocks/dto/runs';
import {
  chainNoteOf,
  formatDuration,
  groupByTicket,
  groupKeyOf,
  linkedTicketsByRun,
  prRefsOf,
  safeHref,
  startOfLocalDay,
  ticketRunCounts,
  toIgnored,
  todaySummary,
  toRunSummary,
  withPrState,
} from './map';

const base = runFixtures.find((r) => r.number === 60);
if (!base) throw new Error('run 60 fixture missing');

/** A local-time ISO string, so HH:mm assertions hold in any time zone. */
const local = (h: number, m: number, s = 0) => new Date(2026, 10, 12, h, m, s).toISOString();
const now = new Date(2026, 10, 12, 14, 20);

const run = (over: Partial<RunDto>): RunDto => ({ ...base, ...over });

describe('toRunSummary, failed in setup', () => {
  it('a null start time gives the queue time, no duration and the failure reason as the note', () => {
    const s = toRunSummary(
      run({
        status: 'failed',
        startedAt: null,
        queuedAt: local(13, 2),
        finishedAt: local(13, 3),
        failureStage: 'setup',
        failureReason: 'setup failed (exit 1)',
        setupScriptVersion: 5,
      }),
      now,
    );
    expect(s.startedAt).toBe('13:02');
    expect(s.duration).toBeUndefined();
    expect(s.statusNote).toBe('setup failed (exit 1)');
    expect(JSON.stringify(s)).not.toMatch(/NaN|Invalid/);
  });
});

describe('toRunSummary, started column date', () => {
  it('shows the time only for a run started today', () => {
    const s = toRunSummary(run({ status: 'succeeded', startedAt: local(9, 5), finishedAt: local(9, 30) }), now);
    expect(s.startedAt).toBe('09:05');
  });

  it('shows the date and time for a run started before today', () => {
    const earlier = new Date(2026, 10, 11, 23, 58).toISOString();
    const s = toRunSummary(run({ status: 'succeeded', startedAt: earlier, finishedAt: local(0, 10) }), now);
    expect(s.startedAt).toBe('11 Nov, 23:58');
  });

  it('shows the date and time for a queued run whose queue time is before today', () => {
    const earlier = new Date(2026, 9, 3, 8, 1).toISOString();
    const s = toRunSummary(run({ status: 'queued', startedAt: null, queuedAt: earlier, finishedAt: null }), now);
    expect(s.startedAt).toBe('3 Oct, 08:01');
  });
});

describe('toRunSummary, paused and expired', () => {
  it('paused: the duration stops at the pause and the note says how long it can be resumed', () => {
    const s = toRunSummary(
      run({
        status: 'paused',
        startedAt: local(13, 2),
        finishedAt: null,
        pausedAt: local(13, 14, 4),
        sessionExpiresAt: new Date(now.getTime() + 3 * 24 * 3_600_000).toISOString(),
      }),
      now,
    );
    expect(s.duration).toBe('12m 4s');
    expect(s.statusNote).toBe('Can be resumed for 3 days');
  });

  it('expired: its note says the saved session was deleted', () => {
    const s = toRunSummary(
      run({ status: 'expired', startedAt: local(13, 2), finishedAt: local(13, 14, 4), sessionExpiresAt: null }),
      now,
    );
    expect(s.statusNote).toBe('The saved session was deleted');
    expect(s.duration).toBe('12m 4s');
  });
});

describe('toRunSummary, prompt run', () => {
  it('shows Custom prompt where a prompt run has no skill', () => {
    const s = toRunSummary(run({ ruleKind: 'prompt', skillName: null, prompt: 'Triage this.' }), now);
    expect(s.skill).toBe('Custom prompt');
  });
});

describe('toRunSummary, routing rule command', () => {
  it('maps an empty command to an empty string, not a bare slash', () => {
    expect(toRunSummary(run({ command: '' }), now).command).toBe('');
  });

  it('maps a non-empty command to /<command>', () => {
    expect(toRunSummary(run({ command: 'code-build' }), now).command).toBe('/code-build');
  });
});

describe('toRunSummary', () => {
  it('maps a final run: number, slash command, ticket, local start time, "12m 4s" duration', () => {
    const s = toRunSummary(
      run({
        number: 7,
        command: 'code-build',
        status: 'succeeded',
        startedAt: local(13, 2),
        finishedAt: local(13, 14, 4),
      }),
      now,
    );
    expect(s.id).toBe(7);
    expect(s.command).toBe('/code-build');
    expect(s.skill).toBe('code-build');
    expect(s.startedAt).toBe('13:02');
    expect(s.duration).toBe('12m 4s');
    expect(s.ticket).toEqual({
      kind: 'issue',
      number: 142,
      title: 'Export invoices as CSV from the billing page',
      labels: [{ name: 'user-story', color: '#7c8fd8' }],
      href: 'https://github.com/harbor-labs/invoicer-api/issues/142',
    });
    expect(s.triggeredBy).toEqual({ login: 'kim-hale', bot: false });
  });

  it('queued: start time from queuedAt, "Waiting for a slot", no duration', () => {
    const s = toRunSummary(
      run({ status: 'queued', queuedAt: local(14, 12), startedAt: null, finishedAt: null, exitCode: null }),
      now,
    );
    expect(s.startedAt).toBe('14:12');
    expect(s.statusNote).toBe('Waiting for a slot');
    expect(s.duration).toBeUndefined();
  });

  it('idle: elapsed duration and the wait note; failed: the failure reason', () => {
    const idle = toRunSummary(
      run({ status: 'idle', startedAt: local(14, 9), finishedAt: null, idleSince: local(14, 17) }),
      now,
    );
    expect(idle.duration).toBe('11m');
    expect(idle.statusNote).toBe('Waiting 3m. Auto-finish after 30m unattended');
    const tenMinutes = toRunSummary(
      run({ status: 'idle', startedAt: local(14, 9), finishedAt: null, idleSince: local(14, 17), idleEndSeconds: 600 }),
      now,
    );
    expect(tenMinutes.statusNote).toBe('Waiting 3m. Auto-finish after 10m unattended');
    const failed = toRunSummary(run({ status: 'failed', failureReason: 'API authentication failed (401)' }), now);
    expect(failed.statusNote).toBe('API authentication failed (401)');
  });

  it('marks bot authors and keeps only http(s) ticket links', () => {
    expect(toRunSummary(run({ triggeredBy: 'agent-desk[bot]' }), now).triggeredBy).toEqual({
      login: 'agent-desk[bot]',
      bot: true,
    });
    const js = toRunSummary(run({ ticket: { ...base.ticket, url: 'javascript:alert(1)' } }), now);
    expect(js.ticket.href).toBe('');
    expect(safeHref('http://example.test/x')).toBe('http://example.test/x');
    expect(safeHref('//evil.test')).toBe('');
    expect(safeHref('not a url')).toBe('');
  });

  it('drops label colours that are not hex', () => {
    const s = toRunSummary(
      run({ ticket: { ...base.ticket, labels: [{ name: 'x', color: 'red;background:url(x)' }] } }),
      now,
    );
    expect(s.ticket.labels).toEqual([{ name: 'x', color: '' }]);
  });
});

describe('toRunSummary, agent state notes', () => {
  it('running on background work says so', () => {
    const s = toRunSummary(run({ status: 'running', waitingOn: 'background', finishedAt: null }), now);
    expect(s.statusNote).toBe('Waiting on background work');
  });

  it('running with nothing to wait on has no note', () => {
    const s = toRunSummary(run({ status: 'running', waitingOn: null, finishedAt: null }), now);
    expect(s.statusNote).toBeUndefined();
  });

  it('done: how long ago and the auto-finish time', () => {
    const s = toRunSummary(
      run({ status: 'done', startedAt: local(14, 9), finishedAt: null, idleSince: local(14, 17) }),
      now,
    );
    expect(s.statusNote).toBe('Done 3m ago. Auto-finish after 30m unattended');
    const short = toRunSummary(
      run({ status: 'done', startedAt: local(14, 9), finishedAt: null, idleSince: local(14, 17), idleEndSeconds: 900 }),
      now,
    );
    expect(short.statusNote).toBe('Done 3m ago. Auto-finish after 15m unattended');
  });
});

describe('groupByTicket', () => {
  const summary = (number: number, ticketNumber: number) =>
    toRunSummary(
      run({
        number,
        ticket: { ...base.ticket, number: ticketNumber, ref: String(ticketNumber) },
      }),
      now,
    );

  it('groups runs of one ticket, oldest first, with runsUsed and runsMax', () => {
    const groups = groupByTicket([summary(14, 12), summary(9, 12)], 10);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.ticket.number).toBe(12);
    expect(groups[0]?.runs.map((r) => r.id)).toEqual([9, 14]);
    expect(groups[0]?.runsUsed).toBe(2);
    expect(groups[0]?.runsMax).toBe(10);
  });

  it('takes runsUsed from the server ticket counts, even when fewer runs are on the list', () => {
    const t12 = { ...base.ticket, number: 12, ref: '12' };
    const queued = run({ number: 9, ticket: t12, status: 'queued', startedAt: null, finishedAt: null });
    const used = ticketRunCounts([{ ...queued, ticketRunCount: 9, linkedTickets: [] }]);
    const groups = groupByTicket([toRunSummary(queued, now)], 10, used);
    expect(groups[0]?.runs.map((r) => r.id)).toEqual([9]);
    expect(groups[0]?.runsUsed).toBe(9);
    expect(groups[0]?.runsMax).toBe(10);
  });

  it('orders groups by their newest run', () => {
    const groups = groupByTicket([summary(3, 5), summary(8, 6), summary(10, 5)], 10);
    expect(groups.map((g) => g.ticket.number)).toEqual([5, 6]);
  });
});

describe('groupByTicket, linked tickets', () => {
  const entry = (kind: 'issue' | 'pr', number: number, ticketRunCount = 1, over: Partial<LinkedTicketDto> = {}) => ({
    ref: String(number),
    kind,
    number,
    title: `${kind} ${number} title`,
    url: `https://github.com/acme/invoicer-api/${kind === 'pr' ? 'pull' : 'issues'}/${number}`,
    labels: [{ name: 'user-story', color: '0e8a16' }],
    ticketRunCount,
    ...over,
  });
  const sum = (number: number, kind: 'issue' | 'pr', ticketNumber: number) =>
    toRunSummary(
      run({ number, ticket: { ...base.ticket, kind, number: ticketNumber, ref: String(ticketNumber) } }),
      now,
    );
  const links = (...pairs: [number, LinkedTicketDto[]][]) => new Map(pairs);

  it('puts runs of an issue and its linked PR under one group, each with its own run count', () => {
    const groups = groupByTicket(
      [sum(62, 'pr', 148), sum(60, 'issue', 142)],
      10,
      undefined,
      links([60, [entry('pr', 148)]], [62, [entry('issue', 142)]]),
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]?.ticket.number).toBe(142);
    expect(groups[0]?.runsUsed).toBe(1);
    expect(groups[0]?.linked).toEqual([{ ticket: { kind: 'pr', number: 148 }, runsUsed: 1 }]);
    expect(groups[0]?.chainNote).toBe('Issue #142 (1 of 10 runs) → PR #148 (1 of 10 runs)');
    expect(groups[0]?.runs.map((r) => r.id)).toEqual([60, 62]);
  });

  it("a page with only the PR's linked runs is led by the issue, with title, labels and url from linkedTickets", () => {
    const groups = groupByTicket([sum(62, 'pr', 148)], 10, undefined, links([62, [entry('issue', 142, 3)]]));
    expect(groups).toHaveLength(1);
    expect(groups[0]?.ticket).toEqual({
      kind: 'issue',
      number: 142,
      title: 'issue 142 title',
      labels: [{ name: 'user-story', color: '#0e8a16' }],
      href: 'https://github.com/acme/invoicer-api/issues/142',
    });
    expect(groups[0]?.runsUsed).toBe(3);
    expect(groups[0]?.chainNote).toBe('Issue #142 (3 of 10 runs) → PR #148 (1 of 10 runs)');
  });

  it("a page with only the issue's runs shows the merged header with the PR counts", () => {
    const groups = groupByTicket([sum(60, 'issue', 142)], 10, undefined, links([60, [entry('pr', 148, 4)]]));
    expect(groups[0]?.ticket.number).toBe(142);
    expect(groups[0]?.linked).toEqual([{ ticket: { kind: 'pr', number: 148 }, runsUsed: 4 }]);
    expect(groups[0]?.chainNote).toBe('Issue #142 (1 of 10 runs) → PR #148 (4 of 10 runs)');
  });

  it("an issue with two PRs lists both in number order, even when only one PR's runs are on the page", () => {
    const groups = groupByTicket(
      [sum(70, 'pr', 150)],
      10,
      undefined,
      links([70, [entry('issue', 142), entry('pr', 150, 2), entry('pr', 148)]]),
    );
    expect(groups[0]?.linked?.map((l) => l.ticket.number)).toEqual([148, 150]);
    expect(groups[0]?.chainNote).toBe('Issue #142 (1 of 10 runs) → PR #148 (1 of 10 runs), PR #150 (2 of 10 runs)');
  });

  it('runs are oldest first across tickets and the group sits by its newest run', () => {
    const groups = groupByTicket(
      [sum(80, 'issue', 5), sum(62, 'pr', 148), sum(60, 'issue', 142), sum(50, 'issue', 5)],
      10,
      undefined,
      links([60, [entry('pr', 148)]], [62, [entry('issue', 142)]]),
    );
    expect(groups.map((g) => g.ticket.number)).toEqual([5, 142]);
    expect(groups[1]?.runs.map((r) => r.id)).toEqual([60, 62]);
  });

  it('an unlinked PR keeps its own group with no chain note', () => {
    const groups = groupByTicket([sum(62, 'pr', 148)], 10, undefined, links([62, []]));
    expect(groups[0]?.ticket.kind).toBe('pr');
    expect(groups[0]?.chainNote).toBeUndefined();
    expect(groups[0]?.linked ?? []).toEqual([]);
  });

  it('an issue and a PR with the same number and no link stay apart', () => {
    const groups = groupByTicket([sum(2, 'pr', 7), sum(1, 'issue', 7)], 10);
    expect(groups).toHaveLength(2);
  });

  it('a PR whose linked tickets name two issues joins the lowest-numbered one', () => {
    const groups = groupByTicket(
      [sum(62, 'pr', 148)],
      10,
      undefined,
      links([62, [entry('issue', 150), entry('issue', 142)]]),
    );
    expect(groups[0]?.ticket.number).toBe(142);
  });

  it('a PR run with [] keeps its own group, even when another run of the PR is merged; the two group keys differ', () => {
    const merged = [entry('issue', 142)];
    const groups = groupByTicket(
      [sum(62, 'pr', 148), sum(40, 'pr', 148)],
      10,
      undefined,
      links([62, merged], [40, []]),
    );
    expect(groups.map((g) => `${g.ticket.kind}:${g.ticket.number}`).sort()).toEqual(['issue:142', 'pr:148']);
    expect(groupKeyOf(sum(62, 'pr', 148), merged)).not.toBe(groupKeyOf(sum(40, 'pr', 148), []));
  });

  it('counts are per ticket and never summed', () => {
    const groups = groupByTicket(
      [sum(60, 'issue', 142), sum(62, 'pr', 148)],
      10,
      undefined,
      links([60, [entry('pr', 148, 2)]], [62, [entry('issue', 142, 3)]]),
    );
    const g = groups[0];
    expect(g?.runsUsed).toBe(3);
    expect(g?.linked?.[0]?.runsUsed).toBe(2);
    expect([g?.runsUsed, g?.linked?.[0]?.runsUsed]).not.toContain(5);
  });

  it("groupKeyOf ignores pr entries in a PR run's linked tickets", () => {
    expect(groupKeyOf(sum(62, 'pr', 148), [entry('pr', 140), entry('pr', 150)])).toBe('pr:148');
    expect(groupKeyOf(sum(62, 'pr', 148), [entry('pr', 140), entry('issue', 142)])).toBe('issue:142');
    expect(groupKeyOf(sum(60, 'issue', 142), [entry('issue', 5)])).toBe('issue:142');
  });

  it('a lead taken from linked tickets goes through safeHref and labelColor', () => {
    const bad = entry('issue', 142, 1, { url: 'javascript:alert(1)', labels: [{ name: 'x', color: 'red' }] });
    const groups = groupByTicket([sum(62, 'pr', 148)], 10, undefined, links([62, [bad]]));
    expect(groups[0]?.ticket.href).toBe('');
    expect(groups[0]?.ticket.labels).toEqual([{ name: 'x', color: '' }]);
  });
});

describe('linkedTicketsByRun', () => {
  it('maps each run number to its linked tickets', () => {
    const e = { ref: '1', kind: 'issue' as const, number: 1, title: 't', url: '', labels: [], ticketRunCount: 1 };
    const item = (number: number, linkedTickets: LinkedTicketDto[]): RunListItem => ({
      ...run({ number }),
      ticketRunCount: 1,
      linkedTickets,
    });
    const m = linkedTicketsByRun([item(1, [e]), item(2, [])]);
    expect(m.get(1)).toEqual([e]);
    expect(m.get(2)).toEqual([]);
  });
});

describe('chainNoteOf', () => {
  it('writes "runs" for one and lists PRs in the given order', () => {
    const pr = (number: number, runsUsed: number) => ({ ticket: { kind: 'pr' as const, number }, runsUsed });
    expect(chainNoteOf({ kind: 'issue', number: 142 }, 1, [pr(148, 1)], 10)).toBe(
      'Issue #142 (1 of 10 runs) → PR #148 (1 of 10 runs)',
    );
    expect(chainNoteOf({ kind: 'issue', number: 142 }, 1, [pr(148, 1), pr(150, 2)], 10)).toBe(
      'Issue #142 (1 of 10 runs) → PR #148 (1 of 10 runs), PR #150 (2 of 10 runs)',
    );
  });
});

describe('ticketRunCounts', () => {
  it('maps each ticket key to the server ticketRunCount', () => {
    const item = (number: number, ticketNumber: number, ticketRunCount: number): RunListItem => ({
      ...run({ number, ticket: { ...base.ticket, number: ticketNumber, ref: String(ticketNumber) } }),
      ticketRunCount,
      linkedTickets: [],
    });
    const counts = ticketRunCounts([item(1, 5, 3), item(2, 5, 3), item(3, 6, 1)]);
    expect(counts.get(`${base.ticket.kind}:5`)).toBe(3);
    expect(counts.get(`${base.ticket.kind}:6`)).toBe(1);
  });
});

describe('todaySummary', () => {
  it('reads the server counts, singular for one run, failures only when there are some', () => {
    expect(todaySummary({ total: 9, failed: 1 })).toBe('Today: 9 runs, 1 failed');
    expect(todaySummary({ total: 1, failed: 0 })).toBe('Today: 1 run');
    expect(todaySummary({ total: 0, failed: 0 })).toBe('Today: 0 runs');
  });
});

describe('startOfLocalDay', () => {
  it('is local midnight as an ISO timestamp', () => {
    expect(startOfLocalDay(new Date(2026, 10, 19, 15, 4))).toBe(new Date(2026, 10, 19).toISOString());
  });
});

describe('toIgnored', () => {
  const dto = (outcome: string, over: Partial<IgnoredEventDto> = {}): IgnoredEventDto => ({
    id: 'f0000000-0000-4000-8000-000000000001',
    receivedAt: local(14, 16),
    ticketRef: '160',
    ticketKind: 'issue',
    command: 'code-build',
    author: 'octo-visitor',
    outcome,
    detail: 'octo-visitor is not a collaborator on the repo.',
    ...over,
  });
  const repo = 'https://github.com/harbor-labs/invoicer-api';

  it.each([
    ['ignored_unauthorized', 'Not a collaborator'],
    ['ignored_no_rule', 'No rule for this command'],
    ['ignored_labels', "Ticket labels don't match"],
    ['ignored_target', "Rule doesn't apply to this ticket kind"],
    ['ignored_max_runs', 'Ticket reached its run limit'],
    ['ignored_active_run', 'Same skill already running'],
    ['ignored_rule_disabled', 'Rule is off'],
    ['ignored_no_command', 'Not a command'],
  ])('%s → %s', (outcome, reason) => {
    expect(toIgnored(dto(outcome), repo).reason).toBe(reason);
  });

  it('maps the row: local time, ticket, slash command, author, detail, ticket link', () => {
    expect(toIgnored(dto('ignored_unauthorized'), repo)).toEqual({
      at: '14:16',
      ticket: { kind: 'issue', number: 160 },
      command: '/code-build',
      author: 'octo-visitor',
      reason: 'Not a collaborator',
      detail: 'octo-visitor is not a collaborator on the repo.',
      href: `${repo}/issues/160`,
    });
    expect(toIgnored(dto('ignored_max_runs', { ticketKind: 'pr', ticketRef: '133' }), repo).href).toBe(
      `${repo}/pull/133`,
    );
  });

  it('shows a stored first line that is not a command name as is (the API keeps it for ignored_no_command)', () => {
    expect(toIgnored(dto('ignored_no_command', { command: '/Code-Review now' }), repo).command).toBe(
      '/Code-Review now',
    );
    expect(toIgnored(dto('ignored_no_command', { command: 'please review' }), repo).command).toBe('please review');
    expect(toIgnored(dto('ignored_no_rule', { command: 'docs-fix' }), repo).command).toBe('/docs-fix');
  });

  it('reads a legacy owner/repo#n ticket ref too', () => {
    expect(toIgnored(dto('ignored_no_rule', { ticketRef: 'x/y#77' }), repo).ticket.number).toBe(77);
  });

  it('tolerates missing fields and unknown outcomes', () => {
    const row = toIgnored(
      dto('something_new', { ticketRef: null, ticketKind: null, command: null, author: null, detail: null }),
      repo,
    );
    expect(row).toMatchObject({ reason: 'Ignored', command: '—', author: '—', detail: '', href: repo });
  });
});

describe('formatDuration', () => {
  const s = 1000;
  const m = 60 * s;
  const h = 60 * m;
  const d = 24 * h;
  it.each([
    [0, '0s'],
    [-5 * s, '0s'],
    [48 * s, '48s'],
    [59 * s, '59s'],
    [60 * s, '1m'],
    [30 * m, '30m'],
    [10 * m + 1 * s, '10m 1s'],
    [4 * m + 5 * s, '4m 5s'],
    [37 * m + 48 * s, '37m 48s'],
    [59 * m + 59 * s, '59m 59s'],
    [60 * m, '1h'],
    [60 * m + 59 * s, '1h'],
    [237 * m + 48 * s, '3h 57m'],
    [3 * h + 5 * s, '3h'],
    [23 * h + 59 * m + 59 * s, '23h 59m'],
    [24 * h, '1d'],
    [1500 * m + 20 * s, '1d 1h'],
    [2 * d + 3 * h + 5 * m, '2d 3h 5m'],
    [2 * d + 5 * m, '2d 5m'],
  ])('%i ms -> %s', (ms, text) => {
    expect(formatDuration(ms)).toBe(text);
  });
});

describe('toRunSummary durations', () => {
  it('a final run of 3h 57m reads in hours and minutes', () => {
    const s = toRunSummary(run({ status: 'succeeded', startedAt: local(9, 0, 0), finishedAt: local(12, 57, 48) }), now);
    expect(s.duration).toBe('3h 57m');
  });

  it('a running run counts up to now in the same compact format', () => {
    const started = run({ status: 'running', startedAt: local(10, 20, 0), finishedAt: null });
    expect(toRunSummary(started, now).duration).toBe('4h');
    expect(toRunSummary(started, new Date(now.getTime() + 61_000)).duration).toBe('4h 1m');
  });
});

describe('toRunSummary, run owner', () => {
  it('does not carry the owner id into the row the list shows', () => {
    const s = toRunSummary(run({ ownerUserId: 'user-owner-id-1' }), now);
    expect(JSON.stringify(s)).not.toContain('user-owner-id-1');
  });
});

describe('PR states', () => {
  const states = new Map<string, 'merged' | 'open'>([
    ['148', 'merged'],
    ['142', 'open'],
  ]);

  it('prRefsOf keeps PRs only, as numbers', () => {
    expect(
      prRefsOf([
        { kind: 'pr', number: 148 },
        { kind: 'issue', number: 142 },
        { kind: 'pr', number: 9 },
      ]),
    ).toEqual(['148', '9']);
  });

  it('withPrState sets a known PR, leaves an unknown PR without the key and an issue unchanged', () => {
    expect(withPrState({ kind: 'pr', number: 148 }, states)).toEqual({ kind: 'pr', number: 148, prState: 'merged' });
    expect('prState' in withPrState({ kind: 'pr', number: 7 }, states)).toBe(false);
    const issue = { kind: 'issue' as const, number: 142 };
    expect(withPrState(issue, states)).toBe(issue);
  });
});
