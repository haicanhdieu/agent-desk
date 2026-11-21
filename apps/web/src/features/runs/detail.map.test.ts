import type { PauseReason, RunDto, RunEventDto, RunStatus } from '@agentdesk/contracts';
import { describe, expect, it } from 'vitest';
import type { RunDetailKey } from '@/mocks/types';
import { projectFixtures } from '@/mocks/dto/projects';
import { runFixtures } from '@/mocks/dto/runs';
import {
  pauseReasonText,
  plainText,
  runDetailKey,
  SCROLLBACK_MAX_LINES,
  scrollbackLines,
  scrollbackText,
  terminalArea,
  terminalConnection,
  toRunDetail,
  withDetailPrStates,
  type TerminalArea,
} from './detail.map';

const base = runFixtures.find((r) => r.number === 61);
const project = projectFixtures[0];
if (!base || !project) throw new Error('fixtures missing');

/** A local-time ISO string, so HH:mm:ss assertions hold in any time zone. */
const local = (h: number, m: number, s = 0) => new Date(2026, 10, 12, h, m, s).toISOString();
const now = new Date(2026, 10, 12, 14, 12, 50);
const links = { runs: '/o/alice/p/p1/runs', agent: '/o/alice/p/p1/desk/agent' };

const run = (over: Partial<RunDto>): RunDto => ({ ...base, ...over });
let seq = 0;
const ev = (ts: string, type: RunEventDto['type'], payload: Record<string, unknown>): RunEventDto => ({
  seq: ++seq,
  ts,
  type,
  payload,
});
const detail = (r: RunDto, events: RunEventDto[] = [], ticketRuns: RunDto[] = [r]) =>
  toRunDetail(r, events, project, ticketRuns, now, links);

describe('toRunDetail, final prompt', () => {
  it('carries the final prompt, and null for a run without one', () => {
    expect(detail(run({ finalPrompt: 'Do it.\nTicket: issue #1' })).finalPrompt).toBe('Do it.\nTicket: issue #1');
    expect(detail(run({ finalPrompt: null })).finalPrompt).toBeNull();
  });
});

describe('runDetailKey', () => {
  it.each([
    ['queued', 'RunStarting'],
    ['starting', 'RunStarting'],
    ['running', 'RunRunning'],
    ['idle', 'RunIdle'],
    ['done', 'RunDone'],
    ['succeeded', 'RunSucceeded'],
    ['failed', 'RunFailed'],
    ['timed_out', 'RunTimedOut'],
    ['cancelled', 'RunCancelled'],
    ['paused', 'RunPaused'],
    ['expired', 'RunExpired'],
  ] as [RunStatus, RunDetailKey][])('%s → %s', (status, key) => {
    expect(runDetailKey(status)).toBe(key);
  });

  it('a running run whose terminal is reconnecting → RunReconnect', () => {
    expect(runDetailKey('running', 'reconnect')).toBe('RunReconnect');
    expect(runDetailKey('idle', 'reconnect')).toBe('RunReconnect');
    expect(runDetailKey('done', 'reconnect')).toBe('RunReconnect');
  });

  it('every status of a mapped run gives the key of its board', () => {
    for (const [status, key] of [
      ['queued', 'RunStarting'],
      ['succeeded', 'RunSucceeded'],
      ['cancelled', 'RunCancelled'],
    ] as [RunStatus, RunDetailKey][]) {
      expect(runDetailKey(detail(run({ status })).run.status)).toBe(key);
    }
  });
});

describe('terminalArea', () => {
  const area = (over: Partial<RunDto>, events: RunEventDto[] = []): TerminalArea => terminalArea(run(over), events);
  const parked = (s: string) => ev('2026-11-12T14:00:00.000Z', 'status', { status: s });
  it.each([
    ['running', null, 'live'],
    ['idle', null, 'live'],
    ['done', null, 'live'],
    ['running', '2026-11-12T14:00:00.000Z', 'pausing'],
    ['idle', '2026-11-12T14:00:00.000Z', 'pausing'],
    ['done', '2026-11-12T14:00:00.000Z', 'pausing'],
    ['paused', null, 'paused'],
    ['queued', null, 'starting'],
    ['starting', null, 'starting'],
    ['expired', null, 'expired'],
    ['succeeded', null, 'ended'],
    ['failed', null, 'ended'],
    ['timed_out', null, 'ended'],
    ['cancelled', null, 'ended'],
  ] as [RunStatus, string | null, TerminalArea][])(
    '%s, sessionEndingAt %s → %s',
    (status, sessionEndingAt, expected) => {
      expect(area({ status, sessionEndingAt })).toBe(expected);
    },
  );

  it('a paused run is paused even if a stale sessionEndingAt is still set', () => {
    expect(area({ status: 'paused', sessionEndingAt: '2026-11-12T14:00:00.000Z' })).toBe('paused');
  });

  it.each(['queued', 'starting'] as const)('a %s run that was parked before is resuming', (status) => {
    expect(area({ status }, [parked('paused'), parked('queued')])).toBe('resuming');
    expect(area({ status }, [parked('succeeded'), parked('queued')])).toBe('resuming');
    // A fresh run, or a parked one that ran again since, is starting.
    expect(area({ status }, [parked('queued')])).toBe('starting');
    expect(area({ status }, [parked('paused'), parked('running'), parked('queued')])).toBe('starting');
  });
});

describe('pauseReasonText', () => {
  it.each([
    ['idle_timeout', 'after 30 min with nobody attached'],
    ['pod_lost', 'the pod stopped unexpectedly (out of memory / evicted)'],
    ['agent_crashed', 'the agent crashed'],
    ['stopped', 'stopped by you'],
  ] as [PauseReason, string][])('%s → %s', (reason, text) => {
    expect(pauseReasonText(reason)).toBe(text);
  });
});

describe('toRunDetail, agent note', () => {
  const live = (over: Partial<RunDto>) =>
    detail(run({ status: 'idle', startedAt: local(14, 5), finishedAt: null, idleSince: local(14, 10), ...over }));

  it('carries the agent note for a run that needs you or is done', () => {
    expect(live({ agentNote: 'Which database?' }).agentNote).toBe('Which database?');
    expect(live({ status: 'done', agentNote: 'All set' }).agentNote).toBe('All set');
  });

  it('has no agent note when the run has none', () => {
    expect(live({ agentNote: null }).agentNote).toBeUndefined();
  });
});

describe('toRunDetail, paused, kept and expired sessions', () => {
  const HOUR = 3_600_000;
  const ahead = (ms: number) => new Date(now.getTime() + ms).toISOString();
  const paused = (over: Partial<RunDto> = {}) =>
    run({
      status: 'paused',
      startedAt: local(14, 0),
      finishedAt: null,
      idleSince: null,
      pausedAt: local(14, 10),
      sessionExpiresAt: ahead(6 * 24 * HOUR + HOUR),
      agentNote: 'Which database?',
      ...over,
    });
  const kept = (over: Partial<RunDto> = {}) =>
    run({
      status: 'succeeded',
      startedAt: local(14, 0),
      finishedAt: local(14, 10),
      sessionExpiresAt: new Date(2026, 10, 13, 9, 5).toISOString(),
      agentNote: 'All set',
      ...over,
    });
  const lifecycleEvent = (payload: Record<string, unknown>) => ev(local(14, 11), 'lifecycle', payload);
  /** What `park()` appends after the park: the posted ticket comment. */
  const comment = (kind = 'finish') => ev(local(14, 11), 'comment', { kind, commentId: 'c1' });

  it('paused: the lines above and below the agent note, and the note', () => {
    const d = detail(paused());
    expect(d.session).toEqual({
      state: 'paused',
      headline: 'Paused: waiting for your answer. Can be resumed for 6 days.',
      detail: 'Paused 2 min ago, after 30 min with nobody attached',
    });
    expect(d.agentNote).toBe('Which database?');
  });

  it('paused: the clock stops at the pause and the terminal bar says paused', () => {
    const d = detail(paused());
    expect(d.elapsed).toBe('10:00');
    expect(d.connection).toEqual({ state: 'ended', label: 'Paused' });
    expect(d.endNote).toBeUndefined();
  });

  it('paused with a stored scrollback: the line count in the terminal bar', () => {
    const d = detail(paused(), [ev(local(14, 10), 'scrollback', { text: 'a\nb' })]);
    expect(d.connection).toEqual({ state: 'ended', label: 'Paused, read-only, 2 lines' });
  });

  it('paused without times: only what is known', () => {
    const d = detail(paused({ pausedAt: null, sessionExpiresAt: null }));
    expect(d.session).toEqual({ state: 'paused' });
  });

  describe('paused by a lost pod', () => {
    const lost = (over: Partial<RunDto> = {}) => paused({ pauseReason: 'pod_lost', ...over });
    const exited = (code: unknown) => ev(local(14, 10), 'lifecycle', { line: 41, kind: 'pod_exit', code });

    it('exit code 137 (what the kernel leaves when it kills for memory): says it ran out of memory', () => {
      expect(detail(lost(), [exited(137)]).session).toEqual({
        state: 'paused',
        headline: 'Paused: the pod was killed, most likely out of memory (exit code 137)',
        detail: 'Paused 2 min ago, the pod stopped unexpectedly (out of memory / evicted). Can be resumed for 6 days.',
      });
    });

    describe('automatic resume gave up', () => {
      const gaveUp = (tries: unknown) => lifecycleEvent({ kind: 'auto_resume_gave_up', tries, text: 'gave up' });
      const parked = ev(local(14, 10), 'status', { status: 'paused' });
      const oom = 'Paused: the pod was killed, most likely out of memory (exit code 137)';

      it('shows the tries line and keeps the headline', () => {
        const d = detail(lost(), [parked, exited(137), gaveUp(5), comment('paused')]);
        expect(d.session?.autoResumeGaveUp).toBe('Tried to resume automatically 5 times.');
        expect(d.session?.headline).toBe(oom);
      });

      it('one try is singular', () => {
        expect(detail(lost(), [parked, exited(137), gaveUp(1)]).session?.autoResumeGaveUp).toBe(
          'Tried to resume automatically 1 time.',
        );
      });

      it('an agent crash gets the line and its own headline', () => {
        const crashed = paused({ pauseReason: 'agent_crashed' });
        const end = ev(local(14, 10), 'lifecycle', { kind: 'session_ended', reason: 'agent_exit', code: 1 });
        const d = detail(crashed, [parked, end, gaveUp(5)]);
        expect(d.session?.autoResumeGaveUp).toBe('Tried to resume automatically 5 times.');
        expect(d.session?.headline).toBe('Paused: agent crashed (exit code 1)');
      });

      it('no event: no line', () => {
        expect(detail(lost(), [parked, exited(137)]).session?.autoResumeGaveUp).toBeUndefined();
      });

      it.each([0, 11, '5', undefined])('tries %s is not a valid count: no line', (tries) => {
        expect(detail(lost(), [parked, gaveUp(tries)]).session?.autoResumeGaveUp).toBeUndefined();
      });

      it('a running status after the event: no line', () => {
        const events = [parked, gaveUp(5), ev(local(14, 12), 'status', { status: 'running' })];
        expect(detail(lost(), events).session?.autoResumeGaveUp).toBeUndefined();
      });

      it('an idle-timeout pause: no line', () => {
        expect(detail(paused(), [parked, gaveUp(5)]).session?.autoResumeGaveUp).toBeUndefined();
      });

      it('a failed resume then giving up: both the failure bar and the line', () => {
        const events = [
          parked,
          lifecycleEvent({ kind: 'resume_failed', reason: 'the pod could not start' }),
          gaveUp(5),
          comment('paused'),
        ];
        const s = detail(lost(), events).session;
        expect(s?.resumeFailure).toBe('Resume failed: the pod could not start');
        expect(s?.autoResumeGaveUp).toBe('Tried to resume automatically 5 times.');
      });

      it('a failed resume without giving up: the bar and no line (still waiting)', () => {
        const events = [parked, lifecycleEvent({ kind: 'resume_failed', reason: 'the pod could not start' })];
        const s = detail(lost(), events).session;
        expect(s?.resumeFailure).toBe('Resume failed: the pod could not start');
        expect(s?.autoResumeGaveUp).toBeUndefined();
      });
    });

    it('another exit code: names the code but does not claim a cause', () => {
      expect(detail(lost(), [exited(143)]).session?.headline).toBe(
        'Paused: the pod stopped unexpectedly (exit code 143)',
      );
    });

    it('without an exit code, or with a malformed one: the plain headline, never "waiting for your answer"', () => {
      for (const events of [[], [exited('x')], [exited(-1)], [exited(256)], [exited(1.5)], [exited(1e21)]]) {
        expect(detail(lost(), events).session?.headline).toBe('Paused: the pod stopped unexpectedly');
      }
    });

    it('a newer pod_exit without a code (pod vanished) wins over an older one: no stale exit code', () => {
      expect(detail(lost(), [exited(137), exited(null)]).session?.headline).toBe(
        'Paused: the pod stopped unexpectedly',
      );
    });

    it('reads the newest pod_exit event', () => {
      expect(detail(lost(), [exited(137), exited(143)]).session?.headline).toMatch(/exit code 143\)$/);
    });

    it('is not read for another pause reason', () => {
      expect(detail(paused({ pauseReason: 'idle_timeout' }), [exited(137)]).session?.headline).toMatch(
        /^Paused: waiting/,
      );
    });

    it('without times: the headline and nothing else', () => {
      expect(detail(lost({ pausedAt: null, sessionExpiresAt: null }), [exited(137)]).session).toEqual({
        state: 'paused',
        headline: 'Paused: the pod was killed, most likely out of memory (exit code 137)',
      });
    });
  });

  describe('paused by a crashed agent', () => {
    const crashed = (over: Partial<RunDto> = {}) => paused({ pauseReason: 'agent_crashed', ...over });
    const ended = (payload: Record<string, unknown>) =>
      ev(local(14, 10), 'lifecycle', { line: 40, kind: 'session_ended', ...payload });

    it('says so with the exit code of the newest session_ended event, and that it can be resumed', () => {
      const events = [
        ended({ reason: 'agent_exit', code: 1 }),
        ev(local(14, 10), 'lifecycle', { text: 'Resumed' }),
        ended({ reason: 'agent_exit', code: 137 }),
      ];
      expect(detail(crashed(), events).session).toEqual({
        state: 'paused',
        headline: 'Paused: agent crashed (exit code 137)',
        detail: 'Paused 2 min ago, the agent crashed. Can be resumed for 6 days.',
      });
    });

    it('without a session_ended event, or with a malformed one: the text without a number', () => {
      for (const events of [
        [],
        [ended({ reason: 'agent_exit', code: 'x' })],
        [ended({ reason: 'agent_exit' })],
        [ended({ reason: 'agent_exit', code: 1.5 })],
        // The code comes from a line the agent could forge: only a plausible exit code is shown.
        [ended({ reason: 'agent_exit', code: -1 })],
        [ended({ reason: 'agent_exit', code: 256 })],
        [ended({ reason: 'agent_exit', code: 1e21 })],
        // A newest event that is malformed is not replaced by an older good one.
        [ended({ reason: 'agent_exit', code: 2 }), ended({ reason: 'agent_exit', code: 'x' })],
        // Only an agent_exit end carries the agent's code.
        [ended({ reason: 'signal', code: 0 })],
      ]) {
        expect(detail(crashed(), events).session?.headline).toBe('Paused: agent crashed');
      }
    });

    it('never puts the text of the event in the page, only the number', () => {
      const d = detail(crashed(), [
        ended({ reason: 'agent_exit', code: 3, text: '<img src=x onerror=alert(1)>', line: 'agentdesk: forged' }),
      ]);
      expect(JSON.stringify(d.session)).not.toMatch(/onerror|forged/);
      expect(d.session?.headline).toBe('Paused: agent crashed (exit code 3)');
    });

    it('the code is read only for a crashed pause', () => {
      const events = [ended({ reason: 'agent_exit', code: 9 })];
      expect(detail(paused({ pauseReason: 'idle_timeout' }), events).session?.headline).toMatch(/^Paused: waiting/);
    });

    it('without times: the headline and nothing else', () => {
      const d = detail(crashed({ pausedAt: null, sessionExpiresAt: null }), [ended({ reason: 'agent_exit', code: 2 })]);
      expect(d.session).toEqual({ state: 'paused', headline: 'Paused: agent crashed (exit code 2)' });
    });
  });

  it('paused with no stored reason (an older run): as an idle timeout', () => {
    expect(detail(paused({ pauseReason: null })).session?.detail).toBe(
      'Paused 2 min ago, after 30 min with nobody attached',
    );
  });

  it('expired after a known keep time: how many days, from the pause to the end', () => {
    const d = detail(
      run({
        status: 'expired',
        startedAt: local(14, 0),
        pausedAt: new Date(2026, 10, 5, 14, 10).toISOString(),
        finishedAt: new Date(2026, 10, 12, 14, 10, 30).toISOString(),
        sessionExpiresAt: null,
      }),
    );
    expect(d.session).toEqual({
      state: 'expired',
      headline: 'Nobody resumed this run within 7 days. The saved session was deleted.',
    });
  });

  it('succeeded without a kept session, a queued resume that could not run: the message shows', () => {
    const events = [
      lifecycleEvent({
        kind: 'resume_failed',
        reason: 'nothing was kept to resume from',
        text: 'The resume could not run',
      }),
      // The park posts the finish comment right after: a `comment` event is the newest on a real run.
      comment(),
    ];
    const d = detail(kept({ sessionExpiresAt: null }), events);
    expect(d.session).toEqual({ state: 'none', resumeFailure: 'Resume failed: nothing was kept to resume from' });
    // A later event hides it again.
    expect(
      detail(kept({ sessionExpiresAt: null }), [...events, ev(local(14, 12), 'status', { status: 'queued' })]).session,
    ).toBeUndefined();
  });

  it('succeeded with a kept session: when it is deleted, and the note', () => {
    const d = detail(kept());
    expect(d.session).toEqual({ state: 'kept', detail: 'Session kept until 13 Nov, 09:05' });
    expect(d.agentNote).toBe('All set');
    expect(d.endNote?.title).toMatch(/^Succeeded in /);
  });

  it('succeeded whose session time has passed: no session and no note, as today', () => {
    const d = detail(kept({ sessionExpiresAt: new Date(now.getTime() - 1000).toISOString() }));
    expect(d.session).toBeUndefined();
    expect(d.agentNote).toBeUndefined();
    const none = detail(kept({ sessionExpiresAt: null }));
    expect(none.session).toBeUndefined();
  });

  it('expired: says nobody resumed it in time and that the session was deleted', () => {
    const d = detail(
      run({ status: 'expired', startedAt: local(14, 0), finishedAt: local(14, 12), sessionExpiresAt: null }),
    );
    expect(d.session).toEqual({
      state: 'expired',
      headline: 'Nobody resumed this run in time. The saved session was deleted.',
    });
    expect(d.connection).toEqual({ state: 'ended', label: 'Ended' });
    expect(d.endNote).toBeUndefined();
  });

  it('a resume_failed event last, on a parked run: the failure reason', () => {
    const events = [
      ev(local(14, 10), 'status', { status: 'paused' }),
      lifecycleEvent({ kind: 'resume_failed', reason: 'no saved session was found' }),
      comment('paused'),
    ];
    expect(detail(paused(), events).session?.resumeFailure).toBe('Resume failed: no saved session was found');
    expect(detail(kept(), events).session?.resumeFailure).toBe('Resume failed: no saved session was found');
  });

  it('a resume_failed event that is not the latest, or a run that is not parked: no failure', () => {
    const failed = lifecycleEvent({ kind: 'resume_failed', reason: 'no saved session was found' });
    const later = ev(local(14, 12), 'status', { status: 'queued' });
    expect(detail(paused(), [failed, later]).session?.resumeFailure).toBeUndefined();
    const live = run({ status: 'running', startedAt: local(14, 0), finishedAt: null });
    expect(detail(live, [failed]).session).toBeUndefined();
  });

  it('trailing comment events do not hide the failure; a later status or lifecycle event still does', () => {
    const failed = lifecycleEvent({ kind: 'resume_failed', reason: 'no saved session was found' });
    expect(detail(paused(), [failed, comment('paused'), comment()]).session?.resumeFailure).toBe(
      'Resume failed: no saved session was found',
    );
    // A later resume (queued) or any later lifecycle event after the failure hides it.
    expect(
      detail(paused(), [failed, comment(), ev(local(14, 12), 'status', { status: 'queued' })]).session?.resumeFailure,
    ).toBeUndefined();
    expect(
      detail(paused(), [failed, comment(), lifecycleEvent({ text: 'Pod running' })]).session?.resumeFailure,
    ).toBeUndefined();
    // An older failure followed by a later successful resume is not shown, with comments in between.
    expect(
      detail(paused(), [failed, comment(), ev(local(14, 12), 'status', { status: 'paused' }), comment('paused')])
        .session?.resumeFailure,
    ).toBeUndefined();
  });

  it('a resume_failed event without a text reason shows the plain message', () => {
    const events = [lifecycleEvent({ kind: 'resume_failed' })];
    expect(detail(paused(), events).session?.resumeFailure).toBe('Resume failed');
  });
});

describe('toRunDetail, pausing and resumed runs', () => {
  const live = (over: Partial<RunDto>) =>
    run({ status: 'idle', startedAt: local(14, 0), finishedAt: null, idleSince: local(14, 5), ...over });
  const status = (s: string) => ev(local(14, 6), 'status', { status: s });

  it('a live run with sessionEndingAt set is pausing: no terminal yet, a label for the bar', () => {
    const d = detail(live({ sessionEndingAt: local(14, 12) }));
    expect(d.pausing).toBe(true);
    expect(d.connection).toEqual({ state: 'none', label: 'Ending…' });
  });

  it('a live run without it is not pausing', () => {
    expect(detail(live({})).pausing).toBeUndefined();
  });

  it('a resumed idle run: the banner text with the agent note', () => {
    const events = [
      status('queued'),
      status('running'),
      status('idle'),
      status('paused'),
      status('queued'),
      status('starting'),
    ];
    const d = detail(live({ agentNote: 'Which database?' }), events);
    expect(d.resumed).toBe(
      'Resumed. The agent asked: Which database?. Background tasks and sub-agents that were running when it paused were stopped.',
    );
  });

  it('a resumed run without a note, and a resumed done run', () => {
    const events = [status('paused'), status('queued')];
    expect(detail(live({ agentNote: null }), events).resumed).toBe(
      'Resumed. Background tasks and sub-agents that were running when it paused were stopped.',
    );
    expect(detail(live({ status: 'done', agentNote: 'All set' }), events).resumed).toBe(
      'Resumed. The agent said: All set. Background tasks and sub-agents that were running when it paused were stopped.',
    );
  });

  it('a kept succeeded session that was re-opened counts too', () => {
    expect(detail(live({}), [status('succeeded'), status('queued')]).resumed).toMatch(/^Resumed\./);
  });

  it('not resumed: a fresh run, or one whose next turn already started', () => {
    expect(
      detail(live({}), [status('queued'), status('starting'), status('running'), status('idle')]).resumed,
    ).toBeUndefined();
    expect(detail(live({}), [status('paused'), status('queued'), status('running')]).resumed).toBeUndefined();
    expect(detail(live({}), []).resumed).toBeUndefined();
  });

  it('only live idle and done runs show it', () => {
    const events = [status('paused'), status('queued')];
    expect(detail(live({ status: 'running' }), events).resumed).toBeUndefined();
    expect(
      detail(run({ status: 'paused', startedAt: local(14, 0), pausedAt: local(14, 10) }), events).resumed,
    ).toBeUndefined();
  });

  it('a queued run that was parked before is resuming; a fresh one is not', () => {
    expect(detail(run({ status: 'queued' }), [status('paused'), status('queued')]).resuming).toBe(true);
    expect(detail(run({ status: 'queued' }), [status('queued')]).resuming).toBeUndefined();
  });
});

describe('toRunDetail', () => {
  const running = run({ status: 'running', startedAt: local(14, 5, 10), queuedAt: local(14, 5, 9) });

  it('maps the run facts: summary, elapsed m:ss, start time with seconds, no end', () => {
    const d = detail(running);
    expect(d.run.id).toBe(61);
    expect(d.run.command).toBe('/code-build');
    expect(d.elapsed).toBe('7:40');
    expect(d.startedAt).toBe('14:05:10');
    expect(d.endedAt).toBeUndefined();
    expect(d.rule).toBe('/code-build');
    expect(d.triggerNote).toBe('comment');
    expect(d.connection).toEqual({ state: 'none', label: 'No terminal yet' });
  });

  it('chain: the ticket runs by number, this run marked, others linked with their status', () => {
    const r60 = run({
      number: 60,
      status: 'succeeded',
      startedAt: local(14, 2, 32),
      finishedAt: local(14, 8, 44),
    });
    const r62 = run({ number: 62, status: 'idle', command: 'code-review' });
    const d = detail(running, [], [r62, running, r60]);
    expect(d.chain).toEqual([
      {
        runId: 60,
        command: '/code-build',
        ticket: { kind: 'issue', number: 139 },
        note: 'Succeeded in 6m 12s',
        status: 'succeeded',
        href: `${links.runs}/60`,
      },
      {
        runId: 61,
        command: '/code-build',
        ticket: { kind: 'issue', number: 139 },
        note: 'This run',
        status: 'running',
        here: true,
      },
      {
        runId: 62,
        command: '/code-review',
        ticket: { kind: 'issue', number: 139 },
        note: 'Needs you',
        status: 'idle',
        href: `${links.runs}/62`,
      },
    ]);
  });

  it('chain: the run itself is there even when the ticket list misses it', () => {
    expect(detail(running, [], []).chain.map((c) => c.runId)).toEqual([61]);
  });

  it('lifecycle: the lifecycle events in order, local time with seconds, text only', () => {
    const d = detail(running, [
      ev(local(14, 5, 9), 'lifecycle', { text: 'Comment received, rule matched' }),
      ev(local(14, 5, 10), 'status', { status: 'starting' }),
      ev(local(14, 5, 18), 'lifecycle', { text: 'Pod running' }),
      ev(local(14, 5, 19), 'lifecycle', { nope: 1 }),
    ]);
    expect(d.lifecycle).toEqual([
      { at: '14:05:09', text: 'Comment received, rule matched' },
      { at: '14:05:18', text: 'Pod running' },
    ]);
  });

  it('time: elapsed against timeoutSeconds, with the percent used', () => {
    expect(detail(running).time).toEqual({ elapsed: '7:40', limit: '30 min', percent: 26 });
  });

  it('time: a 24 h limit shows as "24 h" and a long elapsed time as h:mm:ss', () => {
    const long = run({ status: 'running', timeoutSeconds: 86400, startedAt: local(10, 0, 0) });
    const at = new Date(2026, 10, 12, 11, 5, 3);
    const d = toRunDetail(long, [], project, [long], at, links);
    expect(d.time).toEqual({ elapsed: '1:05:03', limit: '24 h', percent: 5 });
  });

  it('timed out after a multi-day limit names the limit in days', () => {
    const r = run({
      status: 'timed_out',
      timeoutSeconds: 604800,
      startedAt: local(10, 0, 0),
      finishedAt: local(10, 0, 0),
    });
    expect(detail(r).endNote?.title).toBe('Timed out at the 7 d limit');
  });

  describe('startup checklist', () => {
    it('queued: waiting for a slot, the rest pending', () => {
      const queued = run({ status: 'queued', queuedAt: local(14, 12, 3), startedAt: null });
      const d = detail(queued, [ev(local(14, 12, 3), 'status', { status: 'queued' })]);
      expect(d.startup?.map((s) => [s.label, s.state, s.at])).toEqual([
        ['Queued', 'active', '14:12:03'],
        ['Slot claimed, token and secret created', 'pending', undefined],
        ['Pod running', 'pending', undefined],
        ['Claude Code started', 'pending', undefined],
        ['Terminal attaches', 'pending', undefined],
      ]);
      expect(d.startup?.[0]?.detail).toBe('Waiting for a slot');
      expect(d.elapsed).toBe('0:47');
    });

    it('starting: slot claimed, waiting for the pod; then the agent once the pod runs', () => {
      const starting = run({ status: 'starting', queuedAt: local(14, 12, 3), startedAt: local(14, 12, 13) });
      const events = [
        ev(local(14, 12, 3), 'status', { status: 'queued' }),
        ev(local(14, 12, 13), 'status', { status: 'starting' }),
      ];
      expect(detail(starting, events).startup?.map((s) => s.state)).toEqual([
        'done',
        'done',
        'active',
        'pending',
        'pending',
      ]);
      expect(detail(starting, events).startup?.[0]?.detail).toBe('Waited 10s for a free slot');
      const podUp = [...events, ev(local(14, 12, 21), 'lifecycle', { text: 'Pod running' })];
      expect(detail(starting, podUp).startup?.map((s) => [s.state, s.at])).toEqual([
        ['done', '14:12:03'],
        ['done', '14:12:13'],
        ['done', '14:12:21'],
        ['active', undefined],
        ['pending', undefined],
      ]);
      const agentUp = [...podUp, ev(local(14, 12, 29), 'lifecycle', { text: 'Session started' })];
      expect(detail(starting, agentUp).startup?.map((s) => s.state)).toEqual([
        'done',
        'done',
        'done',
        'done',
        'active',
      ]);
    });
  });

  describe('startup checklist of a resumed run', () => {
    // The first attempt reached the terminal and parked; the log still holds all of its steps.
    const firstAttempt = [
      ev(local(14, 0, 0), 'status', { status: 'queued' }),
      ev(local(14, 0, 5), 'status', { status: 'starting' }),
      ev(local(14, 0, 12), 'lifecycle', { text: 'Pod running' }),
      ev(local(14, 0, 20), 'lifecycle', { text: 'Session started' }),
      ev(local(14, 0, 25), 'status', { status: 'running' }),
      ev(local(14, 30, 0), 'status', { status: 'succeeded' }),
    ];
    const reopened = (over: Partial<RunDto>) =>
      run({ queuedAt: local(14, 0, 0), startedAt: local(14, 0, 25), ...over });
    const stepStates = (d: ReturnType<typeof detail>) => d.startup?.map((s) => s.state);

    it('queued again: only Queued is active, none of the first attempt steps is done', () => {
      const queued = reopened({ status: 'queued' });
      const events = [...firstAttempt, ev(local(15, 0, 0), 'status', { status: 'queued' })];
      const d = detail(queued, events);
      expect(stepStates(d)).toEqual(['active', 'pending', 'pending', 'pending', 'pending']);
      expect(d.startup?.[0]).toMatchObject({ at: '15:00:00', detail: 'Waiting for a slot' });
    });

    it('queued again, its status event not yet in the log: still only Queued is active', () => {
      expect(stepStates(detail(reopened({ status: 'queued' }), firstAttempt))).toEqual([
        'active',
        'pending',
        'pending',
        'pending',
        'pending',
      ]);
    });

    it('starting again: the slot is the new one and the pod is awaited', () => {
      const starting = reopened({ status: 'starting' });
      const events = [
        ...firstAttempt,
        ev(local(15, 0, 0), 'status', { status: 'queued' }),
        ev(local(15, 0, 8), 'status', { status: 'starting' }),
      ];
      const d = detail(starting, events);
      expect(stepStates(d)).toEqual(['done', 'done', 'active', 'pending', 'pending']);
      expect(d.startup?.[0]?.detail).toBe('Waited 8s for a free slot');
    });

    it('steps complete as the new attempt reaches them', () => {
      const starting = reopened({ status: 'starting' });
      const events = [
        ...firstAttempt,
        ev(local(15, 0, 0), 'status', { status: 'queued' }),
        ev(local(15, 0, 8), 'status', { status: 'starting' }),
        ev(local(15, 0, 15), 'lifecycle', { text: 'Pod running' }),
      ];
      expect(stepStates(detail(starting, events))).toEqual(['done', 'done', 'done', 'active', 'pending']);
    });
  });

  it('idle: since idleSince, ends 30 minutes later, slot note', () => {
    const d = detail(run({ status: 'idle', idleSince: local(14, 3, 58) }));
    expect(d.idle).toEqual({
      since: '14:03:58',
      endsAt: '14:33',
      slotNote: `It holds one of your ${project.maxConcurrentRuns} slots. It ends on its own after 30 minutes with nobody attached.`,
    });
    expect(d.time).toBeUndefined();
  });

  it('idle: ends after the run agent idle end, not a fixed 30 minutes', () => {
    const d = detail(run({ status: 'idle', idleSince: local(14, 3, 58), idleEndSeconds: 600 }));
    expect(d.idle).toEqual({
      since: '14:03:58',
      endsAt: '14:13',
      slotNote: `It holds one of your ${project.maxConcurrentRuns} slots. It ends on its own after 10 minutes with nobody attached.`,
    });
  });

  describe('end note', () => {
    const ended = (over: Partial<RunDto>) =>
      run({ startedAt: local(11, 29, 7), finishedAt: local(11, 30, 17), ...over });

    it('succeeded: duration title, finish time, a link to the next run in the chain', () => {
      const r = ended({ status: 'succeeded', exitCode: 0 });
      const next = run({ number: 62, status: 'idle' });
      const d = detail(r, [], [r, next]);
      expect(d.endNote?.title).toBe('Succeeded in 1m 10s.');
      expect(d.endNote?.body).toBe('Finished at 11:30:17.');
      expect(d.endNote?.actions).toEqual([{ label: 'Go to run 62', href: `${links.runs}/62`, icon: 'chevron-right' }]);
      expect(d.endedAt).toBe('11:30:17');
      expect(d.elapsed).toBe('1:10');
      expect(d.run.duration).toBe('1m 10s');
    });

    it('failed: the failure reason and the exit code', () => {
      const d = detail(ended({ status: 'failed', exitCode: 1, failureReason: 'API authentication failed (401)' }));
      expect(d.endNote?.title).toBe('Failed after 1m 10s: API authentication failed (401)');
      expect(d.endNote?.body).toBe('Claude Code exited with code 1.');
      expect(d.endNote?.actions).toEqual([
        { label: 'Open issue #139', href: 'https://github.com/harbor-labs/invoicer-api/issues/139', icon: 'external' },
      ]);
      expect(d.endedAt).toBe('11:30:17, exit 1');
    });

    it('failed without a reason or exit code', () => {
      const d = detail(ended({ status: 'failed', exitCode: null, failureReason: null }));
      expect(d.endNote?.title).toBe('Failed after 1m 10s');
      expect(d.endNote?.body).toBe('');
      expect(d.endedAt).toBe('11:30:17');
    });

    it('failed: an unsafe ticket url gives no ticket action', () => {
      const r = ended({ status: 'failed', ticket: { ...base.ticket, url: 'javascript:alert(1)' } });
      expect(detail(r).endNote?.actions).toEqual([]);
    });

    it('timed out: the limit, Change time limit, a full meter', () => {
      const r = ended({ status: 'timed_out', startedAt: local(10, 2, 4), finishedAt: local(10, 32, 4) });
      const d = detail(r);
      expect(d.endNote?.title).toBe('Timed out at the 30 min limit');
      expect(d.endNote?.actions).toEqual([{ label: 'Change time limit', href: links.agent, icon: 'clock' }]);
      expect(d.time).toEqual({ elapsed: '30:00', limit: '30 min', percent: 100 });
    });

    it('cancelled: the time it ended, no actions', () => {
      const d = detail(ended({ status: 'cancelled' }));
      expect(d.endNote?.title).toBe('Cancelled at 11:30:17.');
      expect(d.endNote?.actions).toEqual([]);
      expect(d.connection).toEqual({ state: 'ended', label: 'Ended' });
    });

    it('final runs with stored scrollback say how many lines', () => {
      const r = ended({ status: 'succeeded' });
      const d = detail(r, [ev(local(11, 30, 17), 'scrollback', { text: 'a\nb\nc' })]);
      expect(d.connection).toEqual({ state: 'ended', label: 'Ended, read-only, 3 lines' });
    });

    describe('failed in setup', () => {
      // Started_at is set when the session starts, so a run that failed in setup has none.
      const setupFailed = (over: Partial<RunDto> = {}) =>
        run({
          status: 'failed',
          startedAt: null,
          queuedAt: local(11, 29, 0),
          finishedAt: local(11, 30, 17),
          exitCode: 1,
          failureReason: 'setup failed (exit 1)',
          failureStage: 'setup',
          setupScriptVersion: 5,
          ...over,
        });
      const events = [ev(local(11, 29, 7), 'status', { status: 'starting', exitCode: null, failureReason: null })];
      const setupLinks = { ...links, setup: '/o/alice/p/p1/desk/setup' };

      it('maps the stage and the script version for the screen', () => {
        const d = toRunDetail(setupFailed(), events, project, [setupFailed()], now, setupLinks);
        expect(d.failureStage).toBe('setup');
        expect(d.setup).toEqual({ version: 5, note: 'failed, exit 1' });
      });

      it('a null start time never shows NaN: the slot claim (or the queue time) stands in', () => {
        const d = toRunDetail(setupFailed(), events, project, [setupFailed()], now, setupLinks);
        expect(d.startedAt).toBe('11:29:07');
        expect(d.elapsed).toBe('1:10');
        expect(d.endNote?.title).toBe('Setup failed after 1m 10s: the setup script exited with code 1');
        expect(d.endNote?.body).toContain('The agent did not start. Setup version 5');
        expect(d.endNote?.actions[0]).toEqual({
          label: 'Open workspace setup',
          href: setupLinks.setup,
          icon: 'terminal',
        });
        expect(d.endedAt).toBe('11:30:17, setup failed');
        const text = JSON.stringify(d);
        expect(text).not.toContain('NaN');
        expect(text).not.toContain('Invalid');
        const noEvents = toRunDetail(setupFailed(), [], project, [setupFailed()], now, setupLinks);
        expect(noEvents.startedAt).toBe('11:29:00');
        expect(noEvents.elapsed).toBe('1:17');
        expect(JSON.stringify(noEvents)).not.toContain('NaN');
      });

      it('a timed out setup says so', () => {
        const r = setupFailed({ exitCode: 78, failureReason: 'setup timed out' });
        const d = toRunDetail(r, events, project, [r], now, setupLinks);
        expect(d.endNote?.title).toBe('Setup failed after 1m 10s: the setup script timed out');
      });

      it('a failed run without a setup stage is unchanged', () => {
        const d = detail(ended({ status: 'failed', failureStage: 'agent', setupScriptVersion: 3 }));
        expect(d.failureStage).toBe('agent');
        expect(d.endNote?.title).toBe('Failed after 1m 10s');
        expect(d.setup).toEqual({ version: 3 });
      });
    });

    it('active runs have no end note', () => {
      expect(detail(running).endNote).toBeUndefined();
    });
  });
});

describe('scrollbackText', () => {
  it('keeps escape sequences for xterm, uses CRLF line ends and takes the newest scrollback event', () => {
    const events = [
      ev(local(1, 0), 'scrollback', { text: 'old' }),
      ev(local(1, 1), 'scrollback', { text: '\u001b[32mok\u001b[0m\nb\r\nc\rd' }),
    ];
    expect(scrollbackText(events)).toBe('\u001b[32mok\u001b[0m\r\nb\r\nc\rd');
  });

  it('is undefined without a (well-formed) scrollback event; keeps the newest lines only', () => {
    expect(scrollbackText([])).toBeUndefined();
    expect(scrollbackText([ev(local(1, 0), 'scrollback', { lines: 3 })])).toBeUndefined();
    const text = Array.from({ length: SCROLLBACK_MAX_LINES + 2 }, (_, i) => `l${i}`).join('\n');
    const out = scrollbackText([ev(local(1, 0), 'scrollback', { text })])?.split('\r\n');
    expect(out).toHaveLength(SCROLLBACK_MAX_LINES);
    expect(out?.[0]).toBe('l2');
  });
});

describe('terminalConnection', () => {
  it('follows the event stream while the socket is open, otherwise the socket', () => {
    expect(terminalConnection('open', 'live')).toEqual({ state: 'live', label: 'Live' });
    expect(terminalConnection('open', 'reconnecting')).toEqual({ state: 'reconnecting', label: 'Reconnecting…' });
    expect(terminalConnection('connecting', 'live')).toEqual({ state: 'reconnecting', label: 'Connecting…' });
    expect(terminalConnection('retrying', 'live')).toEqual({ state: 'reconnecting', label: 'Reconnecting…' });
    expect(terminalConnection('gave_up', 'live')).toEqual({ state: 'reconnecting', label: 'Disconnected' });
    expect(terminalConnection('forbidden', 'live')).toEqual({ state: 'none', label: 'No access' });
    expect(terminalConnection('ended', 'live')).toEqual({ state: 'ended', label: 'Session ended' });
    expect(terminalConnection('inactive', 'live')).toEqual({ state: 'none', label: 'Closed for inactivity' });
  });
});

describe('scrollbackLines', () => {
  it('splits the stored scrollback into plain text lines', () => {
    expect(scrollbackLines([ev(local(1, 0), 'scrollback', { text: 'one\r\ntwo' })])).toEqual([
      [{ text: 'one' }],
      [{ text: 'two' }],
    ]);
  });

  it('strips ANSI escapes and control characters; markup stays text', () => {
    const text = '\u001b[1;32mPassed!\u001b[0m <img src=x onerror=alert(1)>\u0007\n\u001b]0;title\u0007done';
    expect(scrollbackLines([ev(local(1, 0), 'scrollback', { text })])).toEqual([
      [{ text: 'Passed! <img src=x onerror=alert(1)>' }],
      [{ text: 'done' }],
    ]);
  });

  it('strips string sequences with their payloads (DCS, APC, PM, SOS, 8-bit OSC), C1 controls and bidi overrides', () => {
    const text = [
      'a\u001bPq#0;payload\u001b\\b',
      'c\u001b_apc payload\u001b\\d\u001b^pm payload\u0007e\u001bXsos\u001b\\f',
      '\u009d0;8-bit osc\u009cg\u009b31mh\u0085i\u0090dcs\u009cj',
      'evil\u202egnp.exe\u2066x\u2069',
    ].join('\n');
    expect(scrollbackLines([ev(local(1, 0), 'scrollback', { text })])).toEqual([
      [{ text: 'ab' }],
      [{ text: 'cdef' }],
      [{ text: 'ghij' }],
      [{ text: 'evilgnp.exex' }],
    ]);
  });

  it('renders only the newest lines', () => {
    const text = Array.from({ length: SCROLLBACK_MAX_LINES + 10 }, (_, i) => `line ${i}`).join('\n');
    const lines = scrollbackLines([ev(local(1, 0), 'scrollback', { text })]) ?? [];
    expect(lines).toHaveLength(SCROLLBACK_MAX_LINES);
    expect(lines[0]).toEqual([{ text: 'line 10' }]);
    expect(lines.at(-1)).toEqual([{ text: `line ${SCROLLBACK_MAX_LINES + 9}` }]);
  });

  it('no scrollback event (or a malformed one) → undefined', () => {
    expect(scrollbackLines([])).toBeUndefined();
    expect(scrollbackLines([ev(local(1, 0), 'scrollback', { text: 3 })])).toBeUndefined();
  });
});

describe('toRunDetail, stopped and finished sessions', () => {
  const MIN = 60_000;
  const agoMs = (ms: number) => new Date(now.getTime() - ms).toISOString();
  const aheadMs = (ms: number) => new Date(now.getTime() + ms).toISOString();
  const stopped = (over: Partial<RunDto> = {}) =>
    run({
      status: 'paused',
      startedAt: local(14, 0),
      finishedAt: null,
      idleSince: null,
      pausedAt: agoMs(2 * MIN),
      pauseReason: 'stopped',
      sessionExpiresAt: aheadMs((6 * 24 * 60 + 23 * 60 + 58) * MIN),
      ...over,
    });
  const status = (at: string, s: string) => ev(at, 'status', { status: s });

  it("a stopped run's session is Stopped: can be resumed for 7 days. and Stopped by you 2 min ago.", () => {
    const d = detail(stopped());
    expect(d.session).toEqual({
      state: 'paused',
      stopped: true,
      headline: 'Stopped: can be resumed for 7 days.',
      detail: 'Stopped by you 2 min ago.',
    });
  });

  it("a run paused by the idle timer keeps today's headline", () => {
    const d = detail(stopped({ pauseReason: 'idle_timeout', agentNote: null }));
    expect(d.session?.stopped).toBeUndefined();
    expect(d.session?.headline).toBe('Paused: waiting for your answer. Can be resumed for 7 days.');
  });

  it('pausedKeep is 7 days for 604800 seconds', () => {
    expect(detail(stopped({ pausedKeepSeconds: 604800 })).pausedKeep).toBe('7 days');
    expect(detail(stopped({ pausedKeepSeconds: 3600 })).pausedKeep).toBe('1 hour');
  });

  describe('end note after a Finish', () => {
    const succeeded = (over: Partial<RunDto> = {}) =>
      run({
        status: 'succeeded',
        startedAt: local(11, 29, 7),
        finishedAt: local(11, 30, 17),
        sessionExpiresAt: null,
        ...over,
      });

    it('a succeeded run with a paused status before it says Finished. The session was deleted and cannot be resumed.', () => {
      const events = [
        status(local(11, 10), 'paused'),
        status(local(11, 20), 'running'),
        status(local(11, 30), 'succeeded'),
      ];
      expect(detail(succeeded(), events).endNote?.body).toBe(
        'Finished. The session was deleted and cannot be resumed.',
      );
    });

    it("a succeeded run that never paused keeps today's body", () => {
      const events = [status(local(11, 20), 'running'), status(local(11, 30), 'succeeded')];
      expect(detail(succeeded(), events).endNote?.body).toBe('Finished at 11:30:17.');
    });

    it("a succeeded run with a kept session keeps today's body", () => {
      const events = [status(local(11, 10), 'paused'), status(local(11, 30), 'succeeded')];
      const r = succeeded({ sessionExpiresAt: aheadMs(60 * MIN) });
      expect(detail(r, events).endNote?.body).toBe('Finished at 11:30:17.');
    });
  });
});

describe('plainText', () => {
  it('strips U+202E and U+0007 and keeps newlines, tabs and runs of spaces', () => {
    expect(plainText('a‮visible\u0007  b\n\tc     d')).toBe('avisible  b\n\tc     d');
  });
});

describe('toRunDetail, reopened session', () => {
  it('flags a run whose session is reopened, and no other', () => {
    expect(detail(run({ status: 'done', reopenedAt: now.toISOString() })).reopened).toBe(true);
    expect(detail(run({ status: 'done', reopenedAt: null })).reopened).toBeUndefined();
  });
});

describe('withDetailPrStates', () => {
  const states = new Map<string, 'merged'>([
    ['148', 'merged'],
    ['142', 'merged'],
  ]);
  const data = (ticket: { kind: 'pr' | 'issue'; number: number }) => {
    const d = detail(run({ status: 'running' }));
    return {
      ...d,
      run: { ...d.run, ticket: { ...d.run.ticket, ...ticket } },
      chain: [
        { command: '/a', note: '', status: 'done' as const, ticket: { kind: 'issue' as const, number: 142 } },
        { command: '/b', note: '', status: 'done' as const, ticket: { kind: 'pr' as const, number: 148 } },
        { command: '/c', note: '', status: 'future' as const },
      ],
      pullRequest: { ticket: { ...d.run.ticket, kind: 'pr' as const, number: 148 }, diffstat: '+1 -1' },
    };
  };

  it('sets the run ticket, the PR chain steps and the Pull request ticket; issues stay unchanged', () => {
    const out = withDetailPrStates(data({ kind: 'pr', number: 148 }), states);
    expect(out.run.ticket.prState).toBe('merged');
    expect(out.chain[1]?.ticket?.prState).toBe('merged');
    expect(out.chain[0]?.ticket).toEqual({ kind: 'issue', number: 142 });
    expect(out.chain[2]?.ticket).toBeUndefined();
    expect(out.pullRequest?.ticket.prState).toBe('merged');
  });

  it('an issue run stays unchanged', () => {
    const out = withDetailPrStates(data({ kind: 'issue', number: 142 }), states);
    expect(out.run.ticket.prState).toBeUndefined();
  });
});
