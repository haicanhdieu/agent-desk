import { describe, expect, it } from 'vitest';
import { RUN_STATUSES } from '@/ds';
import {
  agentSettings, ignored, projects, rules, runDetails, runs, skills, terminalByRun, ticketGroups,
} from '@/mocks';

const ACTIVE = ['queued', 'starting', 'running', 'idle'];

describe('mock fixtures', () => {
  it('uses valid run statuses and unique run ids', () => {
    for (const r of runs) expect(RUN_STATUSES).toContain(r.status);
    const ids = runs.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual([52, 54, 55, 56, 57, 60, 61, 62, 63]);
  });

  it('flattens ticketGroups into runs', () => {
    expect(ticketGroups.flatMap((g) => g.runs).map((r) => r.id).sort((a, b) => a - b)).toEqual(runs.map((r) => r.id));
  });

  it('has at most one active run per ticket and skill', () => {
    const seen = new Set<string>();
    for (const r of runs.filter((x) => ACTIVE.includes(x.status))) {
      const key = `${r.ticket.kind}#${r.ticket.number}/${r.skill}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  it('keeps every group within its run limit', () => {
    for (const g of ticketGroups) expect(g.runsUsed).toBeLessThanOrEqual(g.runsMax);
  });

  it('matches PRD defaults', () => {
    expect(agentSettings.maxConcurrent).toBe(2);
    expect(agentSettings.maxRunsPerTicket).toBe(10);
    expect(agentSettings.timeoutMinutes).toBe(30);
    expect(agentSettings.idleEndMinutes).toBe(10);
  });

  it('points every enabled rule at an existing skill unless it carries a warning', () => {
    const names = skills.map((s) => s.name);
    for (const r of rules.filter((x) => x.enabled && !x.warning)) expect(names).toContain(r.skill);
    expect(rules.find((r) => r.warning)?.command).toBe('docs-update');
  });

  it('has the five boards of ignored commands and three projects', () => {
    expect(ignored).toHaveLength(5);
    expect(projects.map((p) => p.name)).toEqual(['invoicer-api', 'invoicer-web', 'docs-site']);
  });

  it('has terminal scrollback for the runs that need it', () => {
    expect(Object.keys(terminalByRun).map(Number).sort((a, b) => a - b)).toEqual([54, 56, 60, 61, 62]);
  });

  it('has eight run details whose status matches the board name', () => {
    const expected = {
      RunStarting: 'starting', RunRunning: 'running', RunIdle: 'idle', RunReconnect: 'running',
      RunSucceeded: 'succeeded', RunFailed: 'failed', RunTimedOut: 'timed_out', RunCancelled: 'cancelled',
    } as const;
    expect(Object.keys(runDetails).sort()).toEqual(Object.keys(expected).sort());
    for (const [k, status] of Object.entries(expected)) {
      expect(runDetails[k as keyof typeof expected].run.status).toBe(status);
    }
  });

  it('never carries a credential-looking value (FR-3)', () => {
    const text = JSON.stringify({ agentSettings, ignored, projects, rules, runDetails, runs, skills, terminalByRun, ticketGroups });
    expect(text).not.toMatch(/sk-|token=/);
  });
});
