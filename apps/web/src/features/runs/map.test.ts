import type { IgnoredEventDto, RunDto } from '@agentdesk/contracts';
import { describe, expect, it } from 'vitest';
import { runFixtures } from '@/mocks/dto/runs';
import { chipCounts, groupByTicket, runsPerTicket, safeHref, toIgnored, toRunSummary } from './map';

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

describe('toRunSummary', () => {
  it('maps a final run: number, slash command, ticket, local start time, "12m 04s" duration', () => {
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
    expect(s.duration).toBe('12m 04s');
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
    expect(idle.duration).toBe('11m 00s');
    expect(idle.statusNote).toBe('Waiting 3m. Auto-finish after 10m unattended');
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

  it('takes runsUsed from the unfiltered per-ticket counts, so a filter does not shrink it', () => {
    const t12 = { ...base.ticket, number: 12, ref: '12' };
    const unfiltered = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => run({ number: n, ticket: t12, status: 'succeeded' }));
    const queued = run({ number: 9, ticket: t12, status: 'queued', startedAt: null, finishedAt: null });
    const used = runsPerTicket([...unfiltered, queued]);
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

describe('chipCounts', () => {
  it('takes needs-you, active (incl. idle) and queued from project counts; ended and all from the list', () => {
    const list = runFixtures.filter((r) => r.projectId === base.projectId);
    expect(chipCounts({ needsYou: 1, running: 2, queued: 1 }, list)).toEqual({
      needs_you: 1,
      active: 2,
      queued: 1,
      ended: 6,
      all: 9,
    });
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
