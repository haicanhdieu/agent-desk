import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as signals from '../src/workflows/signals';
import { count, newRun, skipUntil, start, startHarness, stopHarness } from './helpers/run-workflow-harness';

// Its own file: the retry wait needs the test server to skip time, which a cancelled pod left by another test in the
// same environment can block.
beforeAll(startHarness, 240_000);

afterAll(stopHarness);

const OOM = { exitCode: 137, agentStarted: true, podReason: 'OOMKilled' } as const;

describe('RunWorkflow automatic resume retry wait', () => {
  it('an automatic try that could not start is retried after the wait and comes up', async () => {
    const s = newRun({ autoResumeMax: 3 });
    s.parkKeepSeconds = 3600;
    s.resumeCreateFailFirst = 1;
    const h = await start(s);
    await s.logsStarted.promise;
    await h.signal(signals.sessionStarted);
    s.logs.resolve(OOM);
    await skipUntil(() => count(s, 'restoreParked') === 1, 'the first try failing');
    await skipUntil(() => count(s, 'createRunSecretAndJob') === 3, 'the retry after the wait');
    await s.resumeFollowStarted.promise;
    await h.signal(signals.sessionStarted);
    await skipUntil(() => s.statuses.at(-1)?.status === 'idle', 'idle after the retry');

    expect(s.autoResumes.map((r) => (r.event === 'resume' ? r.try : -1))).toEqual([1, 2]);
    expect(count(s, 'postComment:paused')).toBe(0);
    await h.signal(signals.terminalAttached);
    await h.signal(signals.cancel);
    expect((await h.result()).status).toBe('cancelled');
  });
});
