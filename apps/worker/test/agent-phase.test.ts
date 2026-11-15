import { describe, expect, it } from 'vitest';
import type { AgentState } from '@agentdesk/contracts';
import {
  acceptsLegacyFinish,
  atTurnBoundary,
  finishRunRejection,
  finishRunSettled,
  idleFixStatus,
  idleTimerApplies,
  nextTurnState,
  stoppedStatus,
  type TurnState,
} from '../src/workflows/agent-phase';
import type { RunPhase } from '../src/workflows/signals';

const PHASES: RunPhase[] = [
  'loading',
  'waiting_slot',
  'starting',
  'running',
  'idle',
  'agent_done',
  'ending',
  'finalizing',
  'done',
];

const state = (over: Partial<TurnState> = {}): TurnState => ({
  phase: 'running',
  finishRequested: false,
  resumePending: false,
  wroteRunningSinceTurn: false,
  idleFixPending: false,
  ...over,
});

describe('nextTurnState', () => {
  describe('needs_input', () => {
    it.each(PHASES)('from %s: only a running turn ends as idle', (phase) => {
      const next = nextTurnState(state({ phase }), 'needs_input');
      if (phase === 'running') expect(next?.phase).toBe('idle');
      else expect(next).toBeUndefined();
    });
  });

  describe('done', () => {
    it.each(PHASES)('from %s: a running or idle run becomes agent_done', (phase) => {
      const next = nextTurnState(state({ phase }), 'done');
      if (phase === 'running' || phase === 'idle') expect(next?.phase).toBe('agent_done');
      else expect(next).toBeUndefined();
    });
  });

  describe('working', () => {
    it.each(PHASES)('from %s: only an idle or done run resumes, and asks for a running write', (phase) => {
      const next = nextTurnState(state({ phase }), 'working');
      if (phase === 'idle' || phase === 'agent_done')
        expect(next).toMatchObject({ phase: 'running', resumePending: true });
      else expect(next).toBeUndefined();
    });

    it('does not resume once a finish is requested', () => {
      expect(nextTurnState(state({ phase: 'idle', finishRequested: true }), 'working')).toBeUndefined();
      expect(nextTurnState(state({ phase: 'agent_done', finishRequested: true }), 'working')).toBeUndefined();
    });
  });

  describe('waiting', () => {
    it.each(PHASES)('from %s: only an idle or done run moves to running, without a running write', (phase) => {
      const next = nextTurnState(state({ phase }), 'waiting');
      if (phase === 'idle' || phase === 'agent_done')
        expect(next).toMatchObject({ phase: 'running', resumePending: false });
      else expect(next).toBeUndefined();
    });

    it('leaves a pending running write alone (it must not cancel the one working asked for)', () => {
      expect(nextTurnState(state({ phase: 'idle', resumePending: true }), 'waiting')?.resumePending).toBe(true);
    });

    it('does not resume once a finish is requested', () => {
      expect(nextTurnState(state({ phase: 'idle', finishRequested: true }), 'waiting')).toBeUndefined();
    });
  });

  describe('when a turn ends', () => {
    const ends: [AgentState, TurnState['phase']][] = [
      ['needs_input', 'idle'],
      ['done', 'agent_done'],
    ];

    it.each(ends)('%s drops a pending running write', (event, phase) => {
      expect(nextTurnState(state({ resumePending: true }), event)).toMatchObject({ phase, resumePending: false });
    });

    it.each(ends)('%s after the workflow wrote running asks for the idle/done status to be written again', (event) => {
      expect(nextTurnState(state({ wroteRunningSinceTurn: true }), event)).toMatchObject({
        wroteRunningSinceTurn: false,
        idleFixPending: true,
      });
    });

    it.each(ends)('%s without a running write since the last turn asks for nothing', (event) => {
      expect(nextTurnState(state(), event)).toMatchObject({ wroteRunningSinceTurn: false, idleFixPending: false });
    });

    it.each(ends)('%s keeps an earlier idleFixPending that the loop has not handled yet', (event) => {
      expect(nextTurnState(state({ idleFixPending: true }), event)?.idleFixPending).toBe(true);
    });

    it('done on an idle run keeps the fix flag set by the earlier turn end', () => {
      const idle = nextTurnState(state({ wroteRunningSinceTurn: true }), 'needs_input');
      expect(idle).toMatchObject({ phase: 'idle', idleFixPending: true });
      expect(nextTurnState(idle ?? state(), 'done')).toMatchObject({ phase: 'agent_done', idleFixPending: true });
    });
  });

  it('does not mutate its input', () => {
    const before = state({ phase: 'idle' });
    const copy = { ...before };
    nextTurnState(before, 'working');
    expect(before).toEqual(copy);
  });

  it('carries finishRequested through unchanged', () => {
    expect(nextTurnState(state({ finishRequested: true }), 'needs_input')?.finishRequested).toBe(true);
  });

  it('walks a whole session: running, needs input, working, done, working again', () => {
    let s = state();
    const step = (event: AgentState): void => {
      s = nextTurnState(s, event) ?? s;
    };
    step('needs_input');
    expect(s.phase).toBe('idle');
    step('working');
    expect(s).toMatchObject({ phase: 'running', resumePending: true });
    s = { ...s, resumePending: false, wroteRunningSinceTurn: true }; // the main loop wrote `running`
    step('done');
    expect(s).toMatchObject({ phase: 'agent_done', idleFixPending: true });
    step('waiting');
    expect(s.phase).toBe('running');
  });
});

describe('atTurnBoundary and acceptsLegacyFinish', () => {
  it.each(PHASES)('%s', (phase) => {
    const expected = phase === 'idle' || phase === 'agent_done';
    expect(atTurnBoundary(phase)).toBe(expected);
    expect(acceptsLegacyFinish(phase)).toBe(expected);
  });
});

describe('finishRunRejection', () => {
  it.each(PHASES)('phase %s, not ending', (phase) => {
    const reason = finishRunRejection(phase, false);
    if (phase === 'idle' || phase === 'agent_done') expect(reason).toBeUndefined();
    else expect(reason).toBe(`Only a run that needs you or is done can be finished (phase is ${phase})`);
  });

  it.each(PHASES)('phase %s, already ending: always rejected', (phase) => {
    expect(finishRunRejection(phase, true)).toBe(
      `Only a run that needs you or is done can be finished (phase is ${phase})`,
    );
  });
});

describe('finishRunSettled', () => {
  it.each([
    [true, 'idle', true],
    [true, 'ending', true],
    [false, 'ending', false],
    [false, 'idle', false],
    [false, 'finalizing', true],
    [false, 'done', true],
    [false, 'running', false],
    [false, 'agent_done', false],
  ] as [boolean, RunPhase, boolean][])('ending=%s phase=%s -> %s', (ending, phase, expected) => {
    expect(finishRunSettled(ending, phase)).toBe(expected);
  });
});

describe('idleTimerApplies', () => {
  it.each(PHASES)('phase %s with nobody attached and no end under way', (phase) => {
    expect(idleTimerApplies(phase, 0, false)).toBe(phase === 'idle' || phase === 'agent_done');
  });

  it('is off while a terminal is attached', () => {
    expect(idleTimerApplies('idle', 1, false)).toBe(false);
    expect(idleTimerApplies('agent_done', 2, false)).toBe(false);
  });

  it('is off once the session is ending', () => {
    expect(idleTimerApplies('idle', 0, true)).toBe(false);
    expect(idleTimerApplies('agent_done', 0, true)).toBe(false);
  });
});

describe('idleFixStatus', () => {
  it.each(PHASES)('phase %s', (phase) => {
    const expected = phase === 'idle' ? 'idle' : phase === 'agent_done' ? 'done' : undefined;
    expect(idleFixStatus(phase)).toBe(expected);
  });
});

describe('stoppedStatus', () => {
  it.each(PHASES)('a hard timeout in phase %s', (phase) => {
    expect(stoppedStatus('timed_out', phase)).toBe(phase === 'agent_done' ? 'succeeded' : 'timed_out');
  });

  it('a hard timeout with no recorded phase is timed_out', () => {
    expect(stoppedStatus('timed_out', undefined)).toBe('timed_out');
  });

  it.each(PHASES)('a cancel in phase %s is cancelled even after done was declared', (phase) => {
    expect(stoppedStatus('cancelled', phase)).toBe('cancelled');
  });

  it('a Temporal-level cancellation (no stop reason) is cancelled', () => {
    expect(stoppedStatus(undefined, undefined)).toBe('cancelled');
    expect(stoppedStatus(undefined, 'agent_done')).toBe('cancelled');
  });
});
