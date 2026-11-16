import { RunDto, RunEventDto } from '@agentdesk/contracts';
import { describe, expect, it } from 'vitest';
import { terminalArea, toRunDetail } from '@/features/runs/detail.map';
import { projectFixtures } from './projects';
import {
  CRASHED_RUN,
  ENDING_RUN,
  RESUMED_RUN,
  RESUME_FAILED_RUN,
  lifecycleEventFixtures,
  lifecycleRunFixtures,
} from './lifecycleRuns';

// The browser mock's extra runs back the mocked e2e specs: each must parse and read as the state it stands for.
const project = projectFixtures[0];
if (!project) throw new Error('fixtures missing');
const links = { runs: '/o/alice/p/p1/runs', agent: '/o/alice/p/p1/desk/agent' };
const now = new Date();

const open = (number: number) => {
  const run = lifecycleRunFixtures.find((r) => r.number === number);
  if (!run) throw new Error(`run ${number} missing`);
  const events = lifecycleEventFixtures[run.id] ?? [];
  return { run, events, detail: toRunDetail(run, events, project, [run], now, links) };
};

describe('lifecycle fixture runs (browser mock)', () => {
  it('parse through the contract schemas', () => {
    expect(() => lifecycleRunFixtures.forEach((r) => RunDto.parse(r))).not.toThrow();
    expect(() =>
      Object.values(lifecycleEventFixtures)
        .flat()
        .forEach((e) => RunEventDto.parse(e)),
    ).not.toThrow();
  });

  it('the ending run is pausing, with its last scrollback', () => {
    const { run, detail } = open(ENDING_RUN);
    expect(terminalArea(run)).toBe('pausing');
    expect(detail.pausing).toBe(true);
  });

  it('the crashed run is paused with the reason and the exit code', () => {
    const { detail } = open(CRASHED_RUN);
    expect(detail.session?.headline).toMatch(/^Paused: agent crashed \(exit code 3\)$/);
  });

  it('the resume-failed run is succeeded and says nothing was kept', () => {
    const { detail } = open(RESUME_FAILED_RUN);
    expect(detail.session?.resumeFailure).toBe('Resume failed: nothing was kept to resume from');
  });

  it('the resumed run shows the resumed banner with the agent note', () => {
    const { detail } = open(RESUMED_RUN);
    expect(detail.resumed).toMatch(/^Resumed\. The agent asked: Should quotes inside a field be doubled\?\./);
  });
});
