import { describe, expect, it } from 'vitest';
import { RunStatusEvent } from './events';
import { PauseReason, STOPPABLE_RUN_STATUSES } from '../enums';
import { LinkedTicketDto, RunDto, RunListItem, RunStatsDto, RunStatsQuery } from './runs';

const ID = '11111111-1111-4111-8111-111111111111';
const NOW = '2026-11-16T10:00:00.000Z';

const run = {
  id: ID,
  number: 1,
  projectId: ID,
  ruleId: null,
  command: 'triage',
  ruleKind: 'skill',
  skillName: 'triage',
  prompt: null,
  finalPrompt: null,
  agent: { id: ID, name: 'a', model: 'm' },
  ticket: { ref: 'r#1', kind: 'issue', number: 1, title: 't', url: 'https://example.test/1', labels: [] },
  args: null,
  status: 'paused',
  triggerSource: 'manual',
  triggeredBy: null,
  ownerUserId: null,
  queuedAt: NOW,
  startedAt: null,
  finishedAt: null,
  exitCode: null,
  failureReason: null,
  failureStage: null,
  failureCode: null,
  setupScriptVersion: null,
  costUsd: null,
  timeoutSeconds: 3600,
  idleEndSeconds: 1800,
  pausedKeepSeconds: 604800,
  idleSince: null,
  waitingOn: null,
  agentNote: null,
  pausedAt: NOW,
  sessionExpiresAt: NOW,
  sessionEndingAt: null,
  pauseReason: null,
  reopenedAt: null,
  usage: null,
};

const event = {
  runId: ID,
  number: 1,
  status: 'paused',
  seq: 3,
  exitCode: null,
  failureReason: null,
  waitingOn: null,
  agentNote: null,
  pausedAt: NOW,
  sessionExpiresAt: NOW,
  sessionEndingAt: null,
  pauseReason: null,
  reopenedAt: null,
};

describe('RunDto idle end', () => {
  it('carries the agent idle end in seconds', () => {
    const r = RunDto.safeParse({ ...run, idleEndSeconds: 600 });
    expect(r.success && r.data.idleEndSeconds).toBe(600);
  });

  it('requires it', () => {
    const { idleEndSeconds: _omit, ...rest } = run;
    expect(RunDto.safeParse(rest).success).toBe(false);
  });
});

describe('RunDto session ending and pause reason', () => {
  it('parses with both fields null', () => {
    expect(RunDto.safeParse(run).success).toBe(true);
  });

  it('parses a pod_lost pause with an ending time', () => {
    const r = RunDto.safeParse({ ...run, pauseReason: 'pod_lost', sessionEndingAt: NOW });
    expect(r.success && r.data.pauseReason).toBe('pod_lost');
    expect(r.success && r.data.sessionEndingAt).toBe(NOW);
  });

  it('parses an agent_crashed pause', () => {
    const r = RunDto.safeParse({ ...run, pauseReason: 'agent_crashed' });
    expect(r.success && r.data.pauseReason).toBe('agent_crashed');
  });

  it('rejects an unknown pause reason', () => {
    expect(RunDto.safeParse({ ...run, pauseReason: 'oom' }).success).toBe(false);
  });

  it('requires all three fields to be present', () => {
    const { sessionEndingAt: _a, ...noEnding } = run;
    const { pauseReason: _b, ...noReason } = run;
    const { reopenedAt: _c, ...noReopened } = run;
    expect(RunDto.safeParse(noEnding).success).toBe(false);
    expect(RunDto.safeParse(noReason).success).toBe(false);
    expect(RunDto.safeParse(noReopened).success).toBe(false);
  });

  it("carries when a succeeded run's session was reopened", () => {
    const r = RunDto.safeParse({ ...run, status: 'done', reopenedAt: NOW });
    expect(r.success && r.data.reopenedAt).toBe(NOW);
    expect(RunStatusEvent.safeParse({ ...event, status: 'done', reopenedAt: NOW }).success).toBe(true);
  });
});

describe('RunStatusEvent session ending and pause reason', () => {
  it('parses with both fields null and with idle_timeout', () => {
    expect(RunStatusEvent.safeParse(event).success).toBe(true);
    expect(RunStatusEvent.safeParse({ ...event, pauseReason: 'idle_timeout', sessionEndingAt: NOW }).success).toBe(
      true,
    );
  });

  it('parses an agent_crashed pause', () => {
    const r = RunStatusEvent.safeParse({ ...event, pauseReason: 'agent_crashed' });
    expect(r.success && r.data.pauseReason).toBe('agent_crashed');
  });

  it('rejects an unknown pause reason', () => {
    expect(RunStatusEvent.safeParse({ ...event, pauseReason: 'oom' }).success).toBe(false);
  });
});

describe('stopped runs', () => {
  it('knows the stopped pause reason', () => {
    expect(PauseReason.parse('stopped')).toBe('stopped');
  });
  it('lists the stoppable statuses', () => {
    expect([...STOPPABLE_RUN_STATUSES]).toEqual(['running', 'idle', 'done']);
  });
  it('requires pausedKeepSeconds', () => {
    const { pausedKeepSeconds: _omit, ...rest } = run;
    expect(RunDto.safeParse(rest).success).toBe(false);
  });
});

describe('RunListItem ticketRunCount', () => {
  const { prompt: _p, finalPrompt: _f, ...item } = run;

  it('requires the count of runs the ticket has had', () => {
    expect(RunListItem.safeParse({ ...item, linkedTickets: [] }).success).toBe(false);
    expect(RunListItem.safeParse({ ...item, ticketRunCount: 0, linkedTickets: [] }).success).toBe(false);
    const ok = RunListItem.safeParse({ ...item, ticketRunCount: 3, linkedTickets: [] });
    expect(ok.success && ok.data.ticketRunCount).toBe(3);
  });

  describe('RunStatsDto', () => {
    const stats = {
      counts: { needs_you: 2, active: 4, queued: 1, ended: 6, all: 12, ignored: 3 },
      today: { total: 2, failed: 1 },
      idleRun: { ...item, ticketRunCount: 1, linkedTickets: [] },
      nextQueuedNumber: 7,
    };

    it('parses a full example and null idleRun and nextQueuedNumber', () => {
      expect(RunStatsDto.safeParse(stats).success).toBe(true);
      expect(RunStatsDto.safeParse({ ...stats, idleRun: null, nextQueuedNumber: null }).success).toBe(true);
    });

    it('rejects a negative count', () => {
      expect(RunStatsDto.safeParse({ ...stats, today: { total: -1, failed: 0 } }).success).toBe(false);
    });

    it('needs a since timestamp', () => {
      expect(RunStatsQuery.safeParse({}).success).toBe(false);
      expect(RunStatsQuery.safeParse({ since: 'yesterday' }).success).toBe(false);
      expect(RunStatsQuery.safeParse({ since: NOW }).success).toBe(true);
    });
  });
});

describe('LinkedTicketDto and RunListItem.linkedTickets', () => {
  const { prompt: _p, finalPrompt: _f, ...item } = run;
  const entry = {
    ref: 'r#142',
    kind: 'issue',
    number: 142,
    title: 'Group runs',
    url: 'https://example.test/142',
    labels: [{ name: 'user-story', color: '0e8a16' }],
    ticketRunCount: 2,
  };

  it('parses a full entry', () => {
    expect(LinkedTicketDto.safeParse(entry).success).toBe(true);
  });

  it.each(['ref', 'kind', 'number', 'title', 'url', 'labels', 'ticketRunCount'])(
    'rejects an entry without %s',
    (key) => {
      const { [key]: _omit, ...rest } = entry as Record<string, unknown>;
      expect(LinkedTicketDto.safeParse(rest).success).toBe(false);
    },
  );

  it('rejects a ticketRunCount of 0', () => {
    expect(LinkedTicketDto.safeParse({ ...entry, ticketRunCount: 0 }).success).toBe(false);
  });

  it('requires linkedTickets on a list item and round-trips an entry', () => {
    const base = { ...item, ticketRunCount: 1 };
    expect(RunListItem.safeParse(base).success).toBe(false);
    expect(RunListItem.safeParse({ ...base, linkedTickets: [] }).success).toBe(true);
    const ok = RunListItem.safeParse({ ...base, linkedTickets: [entry] });
    expect(ok.success && ok.data.linkedTickets).toEqual([entry]);
  });

  it('parses RunStatsDto with an idleRun that carries linked tickets', () => {
    const r = RunStatsDto.safeParse({
      counts: { needs_you: 0, active: 0, queued: 0, ended: 0, all: 0, ignored: 0 },
      today: { total: 0, failed: 0 },
      idleRun: { ...item, ticketRunCount: 1, linkedTickets: [entry] },
      nextQueuedNumber: null,
    });
    expect(r.success).toBe(true);
  });
});

describe('RunDto owner', () => {
  it('accepts a null owner and an owner id', () => {
    expect(RunDto.safeParse(run).success).toBe(true);
    expect(RunDto.parse({ ...run, ownerUserId: 'user_1' }).ownerUserId).toBe('user_1');
  });

  it('rejects a run without an ownerUserId', () => {
    const withoutOwner: Record<string, unknown> = { ...run };
    delete withoutOwner['ownerUserId'];
    expect(RunDto.safeParse(withoutOwner).success).toBe(false);
  });
});

describe('run usage on the DTOs', () => {
  const summary = {
    inputTokens: 1,
    cacheReadTokens: 2,
    cacheWriteTokens: 3,
    outputTokens: 4,
    reasoningTokens: null,
    totalInputTokens: 6,
    totalTokens: 10,
    modelCount: 1,
    estimatedCostUsd: 0.5,
    partial: false,
  };
  const detail = {
    ...summary,
    models: [],
    priceAsOfEarliest: '2026-01-01T12:00:00Z',
    priceAsOfLatest: '2026-06-01T12:00:00+02:00',
    priceSource: 'litellm',
  };
  const { prompt: _p, finalPrompt: _f, usage: _u, ...item } = run;
  const listItem = { ...item, ticketRunCount: 1, linkedTickets: [] };

  it('RunDto accepts null usage and a detail with models and dates', () => {
    expect(RunDto.safeParse({ ...run, usage: null }).success).toBe(true);
    expect(RunDto.safeParse({ ...run, usage: detail }).success).toBe(true);
  });

  it('RunDto requires the usage key', () => {
    const { usage: _x, ...rest } = run;
    expect(RunDto.safeParse(rest).success).toBe(false);
  });

  it('RunDto refuses a detail without models', () => {
    const { models: _m, ...noModels } = detail;
    expect(RunDto.safeParse({ ...run, usage: noModels }).success).toBe(false);
  });

  it('RunDto refuses a date without a time', () => {
    expect(RunDto.safeParse({ ...run, usage: { ...detail, priceAsOfEarliest: '2026-11-21' } }).success).toBe(false);
  });

  it('RunListItem carries the summary and drops the detail fields', () => {
    const r = RunListItem.parse({ ...listItem, usage: detail });
    expect(r.usage).toEqual(summary);
    expect(r.usage).not.toHaveProperty('models');
    expect(r.usage).not.toHaveProperty('priceAsOfEarliest');
    expect(r.usage).not.toHaveProperty('priceSource');
  });

  it('RunListItem accepts null usage and refuses a bad summary', () => {
    expect(RunListItem.safeParse({ ...listItem, usage: null }).success).toBe(true);
    expect(RunListItem.safeParse({ ...listItem, usage: { ...summary, inputTokens: 'x' } }).success).toBe(false);
  });

  it('RunStatsDto.idleRun.usage is the summary', () => {
    const stats = RunStatsDto.parse({
      counts: { needs_you: 0, active: 0, queued: 0, ended: 0, all: 0, ignored: 0 },
      today: { total: 0, failed: 0 },
      idleRun: { ...listItem, usage: detail },
      nextQueuedNumber: null,
    });
    expect(stats.idleRun?.usage).toEqual(summary);
  });
});

describe('RunDto agent id and failure code', () => {
  it('carries the agent id, null when the agent row is gone', () => {
    const r = RunDto.safeParse({ ...run, agent: { id: null, name: 'a', model: 'm' } });
    expect(r.success && r.data.agent.id).toBeNull();
    expect(RunDto.safeParse({ ...run, agent: { name: 'a', model: 'm' } }).success).toBe(false);
  });

  it('carries a structured failure code, null otherwise', () => {
    const r = RunDto.safeParse({ ...run, failureCode: 'no_credential' });
    expect(r.success && r.data.failureCode).toBe('no_credential');
    expect(RunDto.safeParse({ ...run, failureCode: 'other' }).success).toBe(false);
    const { failureCode: _omit, ...rest } = run;
    expect(RunDto.safeParse(rest).success).toBe(false);
  });

  it('keeps both on a list item', () => {
    const { prompt: _p, finalPrompt: _f, usage: _u, ...base } = run;
    const r = RunListItem.safeParse({
      ...base,
      usage: null,
      ticketRunCount: 1,
      linkedTickets: [],
      failureCode: 'no_credential',
    });
    expect(r.success && r.data.failureCode).toBe('no_credential');
  });
});
