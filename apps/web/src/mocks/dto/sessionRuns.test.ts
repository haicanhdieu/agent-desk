import { RunDto, RunEventDto, RunTranscriptEntryDto } from '@agentdesk/contracts';
import { describe, expect, it } from 'vitest';
import { lifecycleRunFixtures } from './lifecycleRuns';
import { runFixtures } from './runs';
import { autoResumeRunFixtures } from './autoResumeRuns';
import { usageRunFixtures } from './usageRuns';
import { agentListId } from './ids';
import {
  NO_CREDENTIAL_RUN,
  PAUSED_TRANSCRIPT_RUN,
  TRANSCRIPT_LONG_RUN,
  TRANSCRIPT_RICH_RUN,
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
  it('a run that failed for a missing credential carries its agent id and the failure code', () => {
    expect(byNumber(NO_CREDENTIAL_RUN)).toMatchObject({
      status: 'failed',
      failureCode: 'no_credential',
      agent: { id: agentListId(1) },
    });
  });

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
    const others = [...runFixtures, ...lifecycleRunFixtures, ...autoResumeRunFixtures, ...usageRunFixtures];
    const taken = new Set(others.map((r) => r.number));
    expect(numbers.filter((n) => taken.has(n))).toEqual([]);
    expect(new Set(sessionRunFixtures.map((r) => r.id)).size).toBe(numbers.length);
    const takenIds = new Set(others.map((r) => r.id));
    expect(sessionRunFixtures.filter((r) => takenIds.has(r.id))).toEqual([]);
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

  it('shared fixture run 64 keeps no saved transcript; the paused run with a transcript is its own run', () => {
    expect(Object.keys(sessionTranscriptFixtures)).not.toContain(runFixtures.find((r) => r.number === 64)?.id);
    const run = byNumber(PAUSED_TRANSCRIPT_RUN);
    expect(run.status).toBe('paused');
    expect(run.pauseReason).toBe('idle_timeout');
    expect(sessionTranscriptFixtures[run.id]?.length).toBeGreaterThan(0);
  });

  it('the rich run carries the notices, markup and markdown of TC-41.1, TC-43.1 and TC-43.2', () => {
    const texts = (sessionTranscriptFixtures[byNumber(TRANSCRIPT_RICH_RUN).id] ?? []).map((e) => e.text);
    expect(texts).toContain('API Error: 401 invalid credential');
    expect(texts).toContain('<b>bold</b> <script>alert(1)</script>');
    expect(texts.some((t) => t.includes('# Heading') && t.includes('**strong**'))).toBe(true);
    expect(
      texts.some((t) => t.includes('| refunds |') && t.includes('`inline_code`') && t.includes('LONG_CODE_LINE')),
    ).toBe(true);
  });

  it('behaviours and slow actions point at runs that exist', () => {
    for (const n of [...Object.keys(transcriptBehaviours).map(Number), ...slowActionRuns]) byNumber(n);
  });
});
