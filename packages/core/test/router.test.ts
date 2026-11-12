import { describe, expect, it, vi } from 'vitest';
import type { Ticket, TicketEvent } from '../src/adapters/types';
import { buildPrompt } from '../src/router/prompt';
import { parseCommand } from '../src/router/parse-command';
import { routeEvent, type RouteInput, type RuleRow } from '../src/router/route-event';

const rule = (over: Partial<RuleRow> = {}): RuleRow => ({
  id: 'r1',
  command: 'code-review',
  labelFilter: [],
  target: 'any',
  agentId: 'a1',
  skillName: 'code-review',
  enabled: true,
  ...over,
});

const event = (over: Partial<TicketEvent> = {}): TicketEvent => ({
  provider: 'fake',
  deliveryId: 'd1',
  commentId: 'c1',
  externalId: 'x1',
  repoPath: 'acme/app',
  ticketRef: 'acme/app#7',
  ticketKind: 'issue',
  body: '/code-review fast',
  author: 'alice',
  authorAssociation: 'MEMBER',
  createdAt: '2026-11-12T00:00:00Z',
  ...over,
});

const ticketOf = (over: Partial<Ticket> = {}): Ticket => ({
  ref: 'acme/app#7',
  kind: 'issue',
  number: 7,
  title: 't',
  url: 'u',
  labels: [],
  ...over,
});

function input(over: Partial<RouteInput> = {}) {
  const ticket = vi.fn(async () => ticketOf());
  const base: RouteInput = {
    event: event(),
    project: { id: 'p1', maxRunsPerTicket: 3 },
    rules: [rule()],
    ticket,
    counts: { runsForTicket: 0, activeSkillsOnTicket: [] },
    botLogin: 'agentdesk[bot]',
    ...over,
  };
  return { base, ticket: base.ticket as unknown as ReturnType<typeof vi.fn> };
}

describe('parseCommand', () => {
  it.each([
    ['/code-review fast', { command: 'code-review', args: 'fast' }],
    ['/code-review', { command: 'code-review', args: '' }],
    ['/code-review   spaced out  ', { command: 'code-review', args: 'spaced out' }],
    ['/a1-b\nsecond line', { command: 'a1-b', args: '' }],
    ['/x\targ', { command: 'x', args: 'arg' }],
    ['/x $(rm -rf /) `id`', { command: 'x', args: '$(rm -rf /) `id`' }],
    ['/x a\r\nnext', { command: 'x', args: 'a' }],
    ['hi\n/code-review', null],
    ['/Code', null],
    ['/', null],
    ['/code_review', null],
    ['/code-review: now', null],
    [' /code-review', null],
    ['', null],
  ])('parses %j', (body, expected) => {
    expect(parseCommand(body)).toEqual(expected);
  });
});

describe('routeEvent', () => {
  it('routes an authorized comment to a run', async () => {
    const { base } = input();
    const d = await routeEvent(base);
    expect(d).toMatchObject({ kind: 'run', command: 'code-review', args: 'fast' });
    if (d.kind === 'run') {
      expect(d.rule.id).toBe('r1');
      expect(d.ticket).toBeNull();
    }
  });

  it('ignores a comment without a command', async () => {
    const d = await routeEvent(input({ event: event({ body: 'hi\n/code-review' }) }).base);
    expect(d).toMatchObject({ kind: 'ignored', outcome: 'ignored_no_command' });
  });

  it('checks the command before authorization', async () => {
    const d = await routeEvent(input({ event: event({ body: 'hello', authorAssociation: 'NONE' }) }).base);
    expect(d).toMatchObject({ outcome: 'ignored_no_command' });
  });

  it.each(['CONTRIBUTOR', 'NONE', 'FIRST_TIMER', 'FIRST_TIME_CONTRIBUTOR', 'MANNEQUIN', 'owner', ''])(
    'rejects association %j',
    async (authorAssociation) => {
      const d = await routeEvent(input({ event: event({ authorAssociation }) }).base);
      expect(d).toMatchObject({ kind: 'ignored', outcome: 'ignored_unauthorized' });
    },
  );

  it.each(['OWNER', 'MEMBER', 'COLLABORATOR'])('accepts association %s', async (authorAssociation) => {
    const d = await routeEvent(input({ event: event({ authorAssociation }) }).base);
    expect(d.kind).toBe('run');
  });

  it('accepts the bot author with association NONE', async () => {
    const d = await routeEvent(input({ event: event({ author: 'agentdesk[bot]', authorAssociation: 'NONE' }) }).base);
    expect(d.kind).toBe('run');
  });

  it('does not treat an empty botLogin as matching an empty author', async () => {
    const d = await routeEvent(input({ event: event({ author: '', authorAssociation: 'NONE' }), botLogin: '' }).base);
    expect(d).toMatchObject({ outcome: 'ignored_unauthorized' });
  });

  it('checks authorization before rule lookup', async () => {
    const d = await routeEvent(input({ event: event({ authorAssociation: 'NONE' }), rules: [] }).base);
    expect(d).toMatchObject({ outcome: 'ignored_unauthorized' });
  });

  it('ignores an unknown command', async () => {
    const d = await routeEvent(input({ rules: [rule({ command: 'other' })] }).base);
    expect(d).toMatchObject({ outcome: 'ignored_no_rule' });
  });

  it('ignores a disabled rule', async () => {
    const d = await routeEvent(input({ rules: [rule({ enabled: false })] }).base);
    expect(d).toMatchObject({ outcome: 'ignored_rule_disabled' });
  });

  it('matches the rule by command and reports it when disabled', async () => {
    const d = await routeEvent(input({ rules: [rule({ command: 'x' }), rule({ enabled: false })] }).base);
    expect(d).toMatchObject({ outcome: 'ignored_rule_disabled' });
  });

  it.each([
    ['pr', 'issue', 'ignored_target'],
    ['issue', 'pr', 'ignored_target'],
    ['issue', 'issue', 'run'],
    ['pr', 'pr', 'run'],
    ['any', 'issue', 'run'],
    ['any', 'pr', 'run'],
  ] as const)('rule target %s on a %s', async (target, kind, expected) => {
    const d = await routeEvent(input({ event: event({ ticketKind: kind }), rules: [rule({ target })] }).base);
    expect(d.kind === 'run' ? 'run' : d.outcome).toBe(expected);
  });

  it('reports the missing label', async () => {
    const { base } = input({ rules: [rule({ labelFilter: ['ready', 'bug'] })] });
    (base.ticket as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      ticketOf({ labels: [{ name: 'ready', color: 'fff' }] }),
    );
    const d = await routeEvent(base);
    expect(d).toMatchObject({ outcome: 'ignored_labels' });
    expect(d.kind === 'ignored' && d.detail).toContain('bug');
  });

  it('requires every label, compares case-insensitively and returns the ticket', async () => {
    const { base } = input({ rules: [rule({ labelFilter: ['Ready', 'bug'] })] });
    const t = ticketOf({
      labels: [
        { name: 'READY', color: 'fff' },
        { name: 'Bug', color: 'fff' },
        { name: 'extra', color: 'fff' },
      ],
    });
    (base.ticket as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(t);
    const d = await routeEvent(base);
    expect(d.kind).toBe('run');
    if (d.kind === 'run') expect(d.ticket).toEqual(t);
  });

  it('ignores at max runs, allows below it', async () => {
    const at = await routeEvent(input({ counts: { runsForTicket: 3, activeSkillsOnTicket: [] } }).base);
    expect(at).toMatchObject({ outcome: 'ignored_max_runs' });
    const over = await routeEvent(input({ counts: { runsForTicket: 4, activeSkillsOnTicket: [] } }).base);
    expect(over).toMatchObject({ outcome: 'ignored_max_runs' });
    const below = await routeEvent(input({ counts: { runsForTicket: 2, activeSkillsOnTicket: [] } }).base);
    expect(below.kind).toBe('run');
  });

  it('ignores while the same skill is active, not other skills', async () => {
    const same = await routeEvent(input({ counts: { runsForTicket: 0, activeSkillsOnTicket: ['code-review'] } }).base);
    expect(same).toMatchObject({ outcome: 'ignored_active_run' });
    const other = await routeEvent(input({ counts: { runsForTicket: 0, activeSkillsOnTicket: ['triage'] } }).base);
    expect(other.kind).toBe('run');
  });

  it('applies max runs before the active-run guard', async () => {
    const d = await routeEvent(input({ counts: { runsForTicket: 3, activeSkillsOnTicket: ['code-review'] } }).base);
    expect(d).toMatchObject({ outcome: 'ignored_max_runs' });
  });

  it('does not call ticket() when the event carries a kind and the rule has no labels', async () => {
    const { base, ticket } = input();
    await routeEvent(base);
    expect(ticket).not.toHaveBeenCalled();
  });

  it('calls ticket() once when the kind is unknown and the rule has labels, and uses its kind', async () => {
    const { base, ticket } = input({
      event: event({ ticketKind: undefined }),
      rules: [rule({ target: 'pr', labelFilter: ['ready'] })],
    });
    ticket.mockResolvedValue(ticketOf({ kind: 'pr', labels: [{ name: 'ready', color: 'fff' }] }));
    const d = await routeEvent(base);
    expect(d.kind).toBe('run');
    expect(ticket).toHaveBeenCalledTimes(1);
  });

  it('fetches the ticket for the kind when the rule has no labels', async () => {
    const { base, ticket } = input({ event: event({ ticketKind: undefined }), rules: [rule({ target: 'pr' })] });
    const d = await routeEvent(base);
    expect(d).toMatchObject({ outcome: 'ignored_target' });
    expect(ticket).toHaveBeenCalledTimes(1);
  });

  it('fetches the ticket when the kind is unknown even if the rule targets any, so the caller gets it', async () => {
    const { base, ticket } = input({ event: event({ ticketKind: undefined }) });
    const d = await routeEvent(base);
    expect(d.kind === 'run' && d.ticket).toBeTruthy();
    expect(ticket).toHaveBeenCalledTimes(1);
  });

  it('does not call ticket() for events rejected before the target step', async () => {
    const { base, ticket } = input({
      event: event({ ticketKind: undefined, authorAssociation: 'NONE' }),
      rules: [rule({ labelFilter: ['x'] })],
    });
    await routeEvent(base);
    expect(ticket).not.toHaveBeenCalled();
  });

  it('keeps args as untrusted text', async () => {
    const d = await routeEvent(input({ event: event({ body: '/code-review ${HOME}; rm -rf /' }) }).base);
    expect(d).toMatchObject({ kind: 'run', args: '${HOME}; rm -rf /' });
  });
});

describe('buildPrompt', () => {
  it('renders the four-line template for an issue', () => {
    expect(
      buildPrompt({
        skillName: 'code-review',
        ticketKind: 'issue',
        ticketNumber: 7,
        repoPath: 'acme/app',
        args: 'fast',
      }),
    ).toBe(
      [
        'Use the skill "code-review" on issue #7 in acme/app.',
        'Read the ticket and all its comments with the gh CLI before you start.',
        'Arguments from the user: fast',
        'When done, report on the ticket as the skill instructs.',
      ].join('\n'),
    );
  });

  it('renders pull request for pr', () => {
    expect(buildPrompt({ skillName: 's', ticketKind: 'pr', ticketNumber: 1, repoPath: 'a/b', args: '' })).toContain(
      'on pull request #1 in a/b.',
    );
  });
});
