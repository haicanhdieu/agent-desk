import { RunDto, RunEventDto } from '@agentdesk/contracts';
import { describe, expect, it } from 'vitest';
import { toRunDetail } from '@/features/runs/detail.map';
import { projectFixtures } from './projects';
import {
  AUTO_FAILED_GAVE_UP_RUN,
  AUTO_RESUMED_RUNNING_RUN,
  AUTO_WAITING_RUN,
  CRASHED_GAVE_UP_RUN,
  GAVE_UP_ONCE_RUN,
  GAVE_UP_RUN,
  autoResumeEventFixtures,
  autoResumeRunFixtures,
} from './autoResumeRuns';

// The browser mock's automatic-resume runs back the mocked e2e specs: each must parse and read as the state it stands for.
const project = projectFixtures[0];
if (!project) throw new Error('fixtures missing');
const links = { runs: '/o/alice/p/p1/runs', agent: '/o/alice/p/p1/desk/agent' };
const now = new Date();

const open = (number: number) => {
  const run = autoResumeRunFixtures.find((r) => r.number === number);
  if (!run) throw new Error(`run ${number} missing`);
  const events = autoResumeEventFixtures[run.id] ?? [];
  return { run, events, detail: toRunDetail(run, events, project, [run], now, links) };
};

describe('automatic resume fixture runs (browser mock)', () => {
  it('parse through the contract schemas', () => {
    expect(() => autoResumeRunFixtures.forEach((r) => RunDto.parse(r))).not.toThrow();
    expect(() =>
      Object.values(autoResumeEventFixtures)
        .flat()
        .forEach((e) => RunEventDto.parse(e)),
    ).not.toThrow();
  });

  it('the pod-lost run that gave up after 5 tries says so', () => {
    const { detail } = open(GAVE_UP_RUN);
    expect(detail.session?.autoResumeGaveUp).toBe('Tried to resume automatically 5 times.');
  });

  it('the pod-lost run that gave up after 1 try says "1 time"', () => {
    const { detail } = open(GAVE_UP_ONCE_RUN);
    expect(detail.session?.autoResumeGaveUp).toBe('Tried to resume automatically 1 time.');
  });

  it('the crashed run that gave up keeps the crash headline and the gave-up line', () => {
    const { detail } = open(CRASHED_GAVE_UP_RUN);
    expect(detail.session?.headline).toBe('Paused: agent crashed (exit code 1)');
    expect(detail.session?.autoResumeGaveUp).toBe('Tried to resume automatically 5 times.');
  });

  it('the run waiting between tries shows the failed resume and no gave-up line', () => {
    const { detail } = open(AUTO_WAITING_RUN);
    expect(detail.session?.resumeFailure).toBe('Resume failed: the pod could not start');
    expect(detail.session?.autoResumeGaveUp).toBeUndefined();
  });

  it('the run whose last try could not start shows the failure and the gave-up line', () => {
    const { detail } = open(AUTO_FAILED_GAVE_UP_RUN);
    expect(detail.session?.resumeFailure).toBe('Resume failed: the pod could not start');
    expect(detail.session?.autoResumeGaveUp).toBe('Tried to resume automatically 5 times.');
  });

  it('the running run lists the automatic resume line between the two pod lines', () => {
    const { detail } = open(AUTO_RESUMED_RUNNING_RUN);
    const texts = (detail.lifecycle ?? []).map((l) => l.text);
    const line = 'The last session was killed (OOMKilled, exit 137, limit 3Gi). Resuming automatically, try 1 of 5.';
    expect(texts.indexOf(line)).toBeGreaterThan(texts.indexOf('Claude Code started'));
    expect(texts.indexOf(line)).toBeLessThan(texts.lastIndexOf('Pod running'));
  });
});
