import { describe, expect, it } from 'vitest';
import {
  autoResumeEventText,
  autoResumeGaveUpText,
  resumeBracket,
  resumeNoteText,
  usablePodReason,
} from '../../src/kube/resume-note';

const oom = { kind: 'killed', exitCode: 137, podReason: 'OOMKilled' } as const;

describe('resumeBracket', () => {
  it('follows the spec table', () => {
    expect(resumeBracket(oom, '3Gi')).toBe('OOMKilled, exit 137, limit 3Gi');
    expect(resumeBracket({ kind: 'killed', exitCode: 1, podReason: 'Error' }, '3Gi')).toBe('Error, exit 1');
    expect(resumeBracket({ kind: 'killed', exitCode: 1 }, '3Gi')).toBe('exit 1');
    expect(resumeBracket({ kind: 'killed', exitCode: 137, podReason: 'OOM Killed' }, '3Gi')).toBe('exit 137');
    expect(resumeBracket({ kind: 'killed' }, '3Gi')).toBe('exit unknown');
    expect(resumeBracket({ kind: 'killed', exitCode: 300, podReason: 'Error' }, '3Gi')).toBe('Error');
    expect(resumeBracket({ kind: 'lost' }, '3Gi')).toBe('pod lost, no exit code');
    expect(resumeBracket({ kind: 'signal' }, '3Gi')).toBe('SIGTERM from outside');
    expect(resumeBracket({ kind: 'session_gone' }, '3Gi')).toBe('terminal session died');
    expect(resumeBracket({ kind: 'agent_exit', exitCode: 1 }, '3Gi')).toBe('agent CLI exited with code 1');
  });
});

describe('texts', () => {
  it('builds the resume note', () => {
    expect(resumeNoteText({ end: oom, try: 1, max: 5 }, '3Gi')).toBe(
      'Agent Desk: your last session was killed (OOMKilled, exit 137, limit 3Gi). Resumed, try 1/5. Background processes and /tmp are gone.',
    );
    expect(resumeNoteText({ end: oom }, '3Gi')).toBe(
      'Agent Desk: your last session was killed (OOMKilled, exit 137, limit 3Gi). Resumed. Background processes and /tmp are gone.',
    );
  });
  it('builds the event texts', () => {
    expect(autoResumeEventText({ end: oom, try: 1, max: 5 }, '3Gi')).toBe(
      'The last session was killed (OOMKilled, exit 137, limit 3Gi). Resuming automatically, try 1 of 5.',
    );
    expect(autoResumeGaveUpText(5)).toBe('Gave up resuming automatically after 5 tries.');
    expect(autoResumeGaveUpText(1)).toBe('Gave up resuming automatically after 1 try.');
  });
});

describe('counts that are not whole numbers', () => {
  it('are left out of the texts', () => {
    const bad = [{ try: '1; rm' }, { try: 1.5 }, { max: 11 }, { try: 0 }] as unknown as {
      try?: number;
      max?: number;
    }[];
    for (const b of bad) {
      const input = { end: oom, try: 1, max: 5, ...b };
      expect(resumeNoteText(input, '3Gi')).toBe(
        'Agent Desk: your last session was killed (OOMKilled, exit 137, limit 3Gi). Resumed. Background processes and /tmp are gone.',
      );
      expect(autoResumeEventText(input, '3Gi')).toBe(
        'The last session was killed (OOMKilled, exit 137, limit 3Gi). Resuming automatically.',
      );
    }
    expect(autoResumeGaveUpText('5; x' as unknown as number)).toBe('Gave up resuming automatically.');
  });
});

describe('usablePodReason', () => {
  it('keeps plain words and drops anything else', () => {
    expect(usablePodReason('OOMKilled')).toBe('OOMKilled');
    expect(usablePodReason('A'.repeat(40))).toBe('A'.repeat(40));
    for (const bad of ['OOM Killed', 'OOMKilled;rm', 'A'.repeat(41), '', null, undefined, 'ÖOMKilled'])
      expect(usablePodReason(bad)).toBeUndefined();
  });
});
