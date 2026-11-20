import { describe, expect, it } from 'vitest';
import { RunStatusEvent } from './events';
import { PauseReason, STOPPABLE_RUN_STATUSES } from '../enums';
import { RunDto, RunListItem, RunStatsDto, RunStatsQuery } from './runs';

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
  agent: { name: 'a', model: 'm' },
  ticket: { ref: 'r#1', kind: 'issue', number: 1, title: 't', url: 'https://example.test/1', labels: [] },
  args: null,
  status: 'paused',
  triggerSource: 'manual',
  triggeredBy: null,
  queuedAt: NOW,
  startedAt: null,
  finishedAt: null,
  exitCode: null,
  failureReason: null,
  failureStage: null,
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

  it('requires both fields to be present', () => {
    const { sessionEndingAt: _a, ...noEnding } = run;
    const { pauseReason: _b, ...noReason } = run;
    expect(RunDto.safeParse(noEnding).success).toBe(false);
    expect(RunDto.safeParse(noReason).success).toBe(false);
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
    expect(RunListItem.safeParse(item).success).toBe(false);
    expect(RunListItem.safeParse({ ...item, ticketRunCount: 0 }).success).toBe(false);
    const ok = RunListItem.safeParse({ ...item, ticketRunCount: 3 });
    expect(ok.success && ok.data.ticketRunCount).toBe(3);
  });

  describe('RunStatsDto', () => {
    const stats = {
      counts: { needs_you: 2, active: 4, queued: 1, ended: 6, all: 12, ignored: 3 },
      today: { total: 2, failed: 1 },
      idleRun: { ...item, ticketRunCount: 1 },
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
