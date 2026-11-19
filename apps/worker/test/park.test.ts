import { describe, expect, it } from 'vitest';
import {
  RESUME_MIN_SECONDS,
  cancelEffect,
  endOutcome,
  parkKindOf,
  phaseOfParkKind,
  resumeRejection,
  sessionAllowanceSeconds,
  statusOfParkKind,
  type EndOutcome,
  type ParkKind,
  type PauseReason,
} from '../src/workflows/park';
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
  'parked',
  'resuming',
];

describe('park kinds', () => {
  it('maps the turn-boundary phases and nothing else', () => {
    for (const phase of PHASES) {
      const expected = phase === 'idle' ? 'needs_input' : phase === 'agent_done' ? 'done' : undefined;
      expect(parkKindOf(phase)).toBe(expected);
    }
  });

  it('maps a kind back to its phase and status', () => {
    expect(phaseOfParkKind('needs_input')).toBe('idle');
    expect(phaseOfParkKind('done')).toBe('agent_done');
    expect(statusOfParkKind('needs_input')).toBe('idle');
    expect(statusOfParkKind('done')).toBe('done');
  });
});

describe('sessionAllowanceSeconds', () => {
  it('RESUME_MIN_SECONDS is one hour', () => {
    expect(RESUME_MIN_SECONDS).toBe(3600);
  });
  it('raises a resume to the minimum when less is left', () => {
    expect(sessionAllowanceSeconds(86400, 86280, true)).toBe(3600);
  });
  it('gives a resume the unused part when it is above the minimum', () => {
    expect(sessionAllowanceSeconds(86400, 3600, true)).toBe(82800);
  });
  it('uses a given minimum instead of one hour (a test seam)', () => {
    expect(sessionAllowanceSeconds(100, 99, true, 5)).toBe(5);
    expect(sessionAllowanceSeconds(100, 10, true, 5)).toBe(90);
  });
  it('gives a first start the whole limit', () => {
    expect(sessionAllowanceSeconds(86400, 0, false)).toBe(86400);
  });
  it('never goes below zero for a first start with the limit used up', () => {
    expect(sessionAllowanceSeconds(100, 500, false)).toBe(0);
  });
  it('a resume with the limit over-used still gets the minimum', () => {
    expect(sessionAllowanceSeconds(100, 500, true)).toBe(3600);
  });
});

describe('resumeRejection', () => {
  it.each(PHASES)('phase %s', (phase) => {
    const reason = resumeRejection(phase);
    if (phase === 'parked' || phase === 'ending') expect(reason).toBeUndefined();
    else if (phase === 'resuming') expect(reason).toBe('This run is already being resumed');
    else expect(reason).toBe('Only a paused run, or a finished run whose session is still kept, can be resumed');
  });
});

describe('cancelEffect', () => {
  it('aborts a resume that has no session up yet', () => {
    expect(cancelEffect('resuming', 'needs_input', false)).toBe('abort_resume');
    expect(cancelEffect('resuming', 'done', false)).toBe('abort_resume');
  });
  it('stops a resume whose session is up', () => {
    expect(cancelEffect('resuming', 'needs_input', true)).toBe('stop_run');
  });
  it('ignores a cancel on a parked done run', () => {
    expect(cancelEffect('parked', 'done', false)).toBe('ignore');
  });
  it('stops a parked needs_input run', () => {
    expect(cancelEffect('parked', 'needs_input', false)).toBe('stop_run');
  });
  it.each(PHASES.filter((p) => p !== 'parked' && p !== 'resuming'))('stops a run in phase %s', (phase) => {
    expect(cancelEffect(phase, undefined, false)).toBe('stop_run');
  });
});

describe('endOutcome', () => {
  type Input = Parameters<typeof endOutcome>[0];
  const base: Input = { ending: false, finishRequested: false, phase: 'running', podLost: false, exitCode: 0 };
  const park = (parkKind: ParkKind, reason: PauseReason): EndOutcome => ({ kind: 'park', parkKind, reason });

  it.each<[string, Partial<Input>, EndOutcome]>([
    [
      'a person Finish while ending succeeds',
      { ending: true, finishRequested: true, phase: 'ending' },
      { kind: 'succeeded' },
    ],
    [
      'the idle timer ending parks as idle_timeout, keeping the kind it recorded',
      { ending: true, phase: 'ending', parkKind: 'needs_input', endReason: 'stop_request' },
      park('needs_input', 'idle_timeout'),
    ],
    [
      'the idle timer ending a done run parks it as done',
      { ending: true, phase: 'ending', parkKind: 'done', endReason: 'signal' },
      park('done', 'idle_timeout'),
    ],
    [
      'the idle timer ending wins over a lost pod',
      { ending: true, phase: 'ending', parkKind: 'needs_input', podLost: true },
      park('needs_input', 'idle_timeout'),
    ],
    [
      'a lost pod while running parks as needs_input',
      { phase: 'running', podLost: true },
      park('needs_input', 'pod_lost'),
    ],
    ['a lost pod while idle parks as needs_input', { phase: 'idle', podLost: true }, park('needs_input', 'pod_lost')],
    ['a lost pod while done parks as done', { phase: 'agent_done', podLost: true }, park('done', 'pod_lost')],
    [
      'a pod that ended with an exit code but no end line was lost (OOMKilled)',
      { phase: 'running', exitCode: 137 },
      park('needs_input', 'pod_lost'),
    ],
    [
      'a pod that ended with no end line while done was lost',
      { phase: 'agent_done', exitCode: 137 },
      park('done', 'pod_lost'),
    ],
    [
      'an end the worker did not ask for (SIGTERM from outside) was a lost pod',
      { phase: 'idle', endReason: 'signal', exitCode: 0 },
      park('needs_input', 'pod_lost'),
    ],
    [
      'a vanished tmux session the worker did not ask for was a lost pod',
      { phase: 'running', endReason: 'session_gone', exitCode: 0 },
      park('needs_input', 'pod_lost'),
    ],
    ['agent exit code 0 succeeds', { phase: 'running', endReason: 'agent_exit', exitCode: 0 }, { kind: 'succeeded' }],
    [
      'agent exit non-zero while running parks as agent_crashed (D1)',
      { phase: 'running', endReason: 'agent_exit', exitCode: 1 },
      park('needs_input', 'agent_crashed'),
    ],
    [
      'agent exit non-zero while idle parks as agent_crashed',
      { phase: 'idle', endReason: 'agent_exit', exitCode: 2 },
      park('needs_input', 'agent_crashed'),
    ],
    [
      'agent exit non-zero while done parks as done with agent_crashed',
      { phase: 'agent_done', endReason: 'agent_exit', exitCode: 1 },
      park('done', 'agent_crashed'),
    ],
    [
      'the pod real exit code decides, never the end reason (a forged agent_exit with a non-zero real code)',
      { phase: 'idle', endReason: 'agent_exit', exitCode: 137 },
      park('needs_input', 'agent_crashed'),
    ],
    [
      'a legacy pod with no end line that exited 0 succeeds as before',
      { phase: 'running', exitCode: 0 },
      { kind: 'succeeded' },
    ],
    [
      'a person Stop while ending parks as stopped',
      { ending: true, phase: 'ending', parkKind: 'needs_input', parkReason: 'stopped', exitCode: 0 },
      park('needs_input', 'stopped'),
    ],
    [
      'a person Stop with a lost pod still parks as stopped',
      { ending: true, phase: 'ending', parkKind: 'needs_input', parkReason: 'stopped', podLost: true },
      park('needs_input', 'stopped'),
    ],
    [
      'a Finish wins over a stop reason',
      { ending: true, finishRequested: true, phase: 'ending', parkKind: 'needs_input', parkReason: 'stopped' },
      { kind: 'succeeded' },
    ],
  ])('%s', (_name, input, expected) => {
    expect(endOutcome({ ...base, ...input })).toEqual(expected);
  });
});
