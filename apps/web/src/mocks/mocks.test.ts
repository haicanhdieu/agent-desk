import { describe, expect, it } from 'vitest';
import { RUN_STATUSES } from '@/ds';
import {
  agentSettings, connectionCopy, connections, connectionWarnings, DEFAULT_POLL_INTERVAL, ignored, menuWarning, pollIntervals,
  projects, rules, runDetails, runs, skills, terminalByRun, ticketGroups,
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

  it('has the five boards of ignored commands and four projects', () => {
    expect(ignored).toHaveLength(5);
    expect(projects.map((p) => p.name)).toEqual(['invoicer-api', 'invoicer-web', 'docs-site', 'billing-jobs']);
  });

  it('gives each project a trigger mode and a status that fits it', () => {
    expect(projects.map((p) => [p.connection.mode, p.connection.tone])).toEqual([
      ['webhook', 'ok'], ['polling', 'ok'], ['webhook', 'warn'], ['polling', 'fail'],
    ]);
    // Only a webhook can go silent; only polling can fail a check.
    for (const c of Object.values(connections)) {
      if (c.tone === 'warn') expect(c.mode).toBe('webhook');
      if (c.tone === 'fail') expect(c.mode).toBe('polling');
    }
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

  it('copies board values faithfully', () => {
    expect(runDetails.RunReconnect.elapsed).toBe('9:02');
    expect(runDetails.RunStarting.elapsed).toBe('0:24');
    expect(runDetails.RunIdle.elapsed).toBe('4:51');
    expect(runDetails.RunReconnect.connection).toEqual({ state: 'reconnecting', label: 'Reconnecting, attempt 3' });
    expect(runDetails.RunReconnect.termSize).toBe('116×38');
    expect(runs.find((r) => r.id === 62)?.statusNote).toBe('Waiting 3m. Auto-finish after 10m unattended');
    expect(runs.find((r) => r.id === 56)?.statusNote).toBe('API authentication failed (401)');
    expect(rules.find((r) => r.command === 'code-build')?.stats).toBe('14 runs this week, last 14:15');
    expect(rules.find((r) => r.command === 'qa-e2e')).toMatchObject({ enabled: false, labels: ['needs-qa'], stats: 'Turned off 3 Nov' });
    expect(ignored[0]).toMatchObject({ at: '14:16', author: 'octo-visitor', reason: 'Author has no write access' });
    expect(ignored[4]).toMatchObject({ command: '/deploy', reason: 'No rule for command' });
    expect(agentSettings.credential).toMatchObject({ setAt: '12 Oct 2026', setBy: 'kim-hale', status: { tone: 'fail', text: 'Rejected at 11:29' } });
    expect(terminalByRun[61][0]).toEqual([
      { text: 'agent-desk runner 0.4.1', tone: 'accent' },
      { text: '  run 61  ·  harbor-labs/invoicer-api', tone: 'dim' },
    ]);
    expect(terminalByRun[56]).toHaveLength(17);
    expect(runDetails.RunSucceeded.pullRequest?.diffstat).toBe('+214 −12');
  });
});

describe('polling copy', () => {
  it('offers 5 min to 30 min, default is the 5 min minimum', () => {
    expect(pollIntervals).toEqual(['5 min', '10 min', '15 min', '30 min']);
    expect(DEFAULT_POLL_INTERVAL).toBe('5 min');
  });

  it('matches the brief and the prototype boards word for word', () => {
    expect(connectionCopy.modeLabel).toBe('How Agent Desk hears about new comments');
    expect(connectionCopy.pollingChecked('5 min', '20s ago')).toBe('Polling every 5 min · last checked 20s ago');
    expect(connectionCopy.pollingCheckedBody('5 min')).toBe('Agent Desk can read comments on this repository. A new command starts a run within 5 minutes.');
    expect(connectionCopy.pollingCheckedBody('30 min')).toMatch(/within 30 minutes\.$/);
    expect(connectionCopy.pollingCostBody).toMatch(/12 an hour at 5 min/);
    expect(connectionCopy.pollingCostBody).toMatch(/5,000 an hour/);
    expect(connections.webhookSilent.text).toBe('No webhooks for 2 days');
    expect(connections.pollingOk.text).toBe('Polling every 5 min');
    expect(connections.pollingRevoked.text).toBe('Polling failed: token revoked');
    expect(connections.pollingRateLimited.text).toBe('Polling failed: rate limited, retry in 5 min');
    expect(connectionCopy.lastEvent('ping, 14:01:37')).toBe('Last event: ping, 14:01:37 (webhook)');
    expect(connectionCopy.lastChecked('20s ago')).toBe('Last checked: 20s ago (polling)');
    expect(connectionCopy.switchToPolling).toBe('Switch to polling');
  });

  it('puts Switch to polling first on the silent-webhook banner only', () => {
    expect(connectionWarnings.webhookSilent.actions.map((a) => a.label)).toEqual(['Switch to polling', 'Check again', 'Connection details']);
    expect(connectionWarnings.webhookSilent.actions[0].variant).toBe('primary');
    expect(connectionWarnings.pollingFailed.actions.map((a) => a.label)).not.toContain('Switch to polling');
  });

  it('names the switcher warning after the mode, and none when ok', () => {
    expect(menuWarning(connections.webhookOk)).toBeUndefined();
    expect(menuWarning(connections.pollingOk)).toBeUndefined();
    expect(menuWarning(connections.webhookSilent)).toBe('webhooks');
    expect(menuWarning(connections.pollingRevoked)).toBe('polling');
  });
});
