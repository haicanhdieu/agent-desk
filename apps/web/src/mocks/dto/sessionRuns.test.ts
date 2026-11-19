import { RunDto, RunEventDto, RunTranscriptEntryDto } from '@agentdesk/contracts';
import { describe, expect, it } from 'vitest';
import { lifecycleRunFixtures } from './lifecycleRuns';
import { runFixtures } from './runs';
import {
  TRANSCRIPT_LONG_RUN,
  sessionEventFixtures,
  sessionRunFixtures,
  sessionTranscriptFixtures,
  transcriptBehaviours,
  slowActionRuns,
} from './sessionRuns';

// The browser mock's stop-session and transcript runs back the mocked e2e specs: each must parse and stay unique.
const byNumber = (n: number) => {
  const run = sessionRunFixtures.find((r) => r.number === n);
  if (!run) throw new Error(`run ${n} missing`);
  return run;
};

describe('session fixture runs (browser mock)', () => {
  it('every run, event and transcript entry parses through the contract schemas', () => {
    expect(() => sessionRunFixtures.forEach((r) => RunDto.parse(r))).not.toThrow();
    expect(() =>
      Object.values(sessionEventFixtures)
        .flat()
        .forEach((e) => RunEventDto.parse(e)),
    ).not.toThrow();
    expect(() =>
      Object.values(sessionTranscriptFixtures)
        .flat()
        .forEach((e) => RunTranscriptEntryDto.parse(e)),
    ).not.toThrow();
  });

  it('run numbers are unique and do not collide with the other fixtures', () => {
    const numbers = sessionRunFixtures.map((r) => r.number);
    expect(new Set(numbers).size).toBe(numbers.length);
    const taken = new Set([...runFixtures, ...lifecycleRunFixtures].map((r) => r.number));
    expect(numbers.filter((n) => taken.has(n))).toEqual([]);
    expect(new Set(sessionRunFixtures.map((r) => r.id)).size).toBe(numbers.length);
  });

  it('seqs are strictly increasing per run', () => {
    for (const entries of Object.values(sessionTranscriptFixtures)) {
      entries.forEach((e, i) => expect(e.seq).toBe(i + 1));
    }
    for (const events of Object.values(sessionEventFixtures)) {
      events.forEach((e, i) => expect(e.seq).toBe(i + 1));
    }
  });

  it('the long run has 1,000 entries and the first is the prompt', () => {
    const entries = sessionTranscriptFixtures[byNumber(TRANSCRIPT_LONG_RUN).id] ?? [];
    expect(entries).toHaveLength(1000);
    expect(entries[0]?.kind).toBe('user');
  });

  it('stopped runs have pauseReason stopped and sessionExpiresAt seven days after pausedAt', () => {
    const stopped = sessionRunFixtures.filter((r) => r.pauseReason === 'stopped' && r.sessionExpiresAt !== null);
    expect(stopped.length).toBeGreaterThanOrEqual(8);
    for (const r of stopped) {
      expect(Date.parse(r.sessionExpiresAt ?? '') - Date.parse(r.pausedAt ?? '')).toBe(7 * 86_400_000);
    }
  });

  it('behaviours and slow actions point at runs that exist', () => {
    for (const n of [...Object.keys(transcriptBehaviours).map(Number), ...slowActionRuns]) byNumber(n);
  });
});
