import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Worker } from '@temporalio/worker';
import { historyToJSON } from '@temporalio/common/lib/proto-utils';
import * as signals from '../src/workflows/signals';
import {
  type Script,
  captured,
  count,
  fixture,
  newRun,
  start,
  startHarness,
  stopHarness,
  waitFor,
  waitPhase,
  workflowsPath,
} from './helpers/run-workflow-harness';

beforeAll(startHarness, 240_000);

afterAll(stopHarness);

const OOM = { exitCode: 137, agentStarted: true, podReason: 'OOMKilled' } as const;

/** Pod `n`'s end: the first pod's logs, or the n-th resumed pod's (a fresh deferred per resume). */
const podEnds = (s: Script, n: number): void => {
  (n === 0 ? s.logs : s.resumeLogs).resolve(OOM);
};

/** A run that is up with its first session started, a long keep time and an agent that resumes `max` times. */
async function running(max: number) {
  const s = newRun({ autoResumeMax: max });
  s.parkKeepSeconds = 3600;
  const h = await start(s);
  await s.logsStarted.promise;
  await h.signal(signals.sessionStarted);
  return { s, h };
}

describe('RunWorkflow automatic resume (auto-resume)', () => {
  it('a pod_lost park resumes by itself and comes back to idle', async () => {
    const { s, h } = await running(5);
    podEnds(s, 0);
    await waitFor(() => count(s, 'createRunSecretAndJob') === 2, 'automatic resume Job');
    await h.signal(signals.sessionStarted);
    await waitFor(() => s.statuses.at(-1)?.status === 'idle', 'idle after the automatic resume');

    expect(s.parkReasons).toEqual(['pod_lost']);
    expect(count(s, 'postComment:paused')).toBe(0);
    expect(s.autoResumes).toEqual([
      {
        event: 'resume',
        try: 1,
        max: 5,
        end: { kind: 'killed', exitCode: 137, podReason: 'OOMKilled' },
        at: expect.any(String),
      },
    ]);
    expect(s.createOpts[1]).toMatchObject({
      resume: true,
      note: { end: { kind: 'killed', exitCode: 137, podReason: 'OOMKilled' }, try: 1, max: 5 },
    });
    await h.signal(signals.terminalAttached);
    await h.signal(signals.cancel);
    expect((await h.result()).status).toBe('cancelled');
    captured['run-auto-resume'] = h;
  });

  it('at the limit (max 1) a second loss leaves the run paused with gave_up and the paused comment', async () => {
    const { s, h } = await running(1);
    podEnds(s, 0);
    await waitFor(() => count(s, 'createRunSecretAndJob') === 2, 'automatic resume Job');
    await h.signal(signals.sessionStarted);
    await waitFor(() => s.statuses.at(-1)?.status === 'idle', 'idle after the automatic resume');
    podEnds(s, 1);
    await waitFor(() => s.autoResumes.length === 2, 'gave_up event');
    await waitPhase(h, 'parked');

    expect(s.autoResumes[1]).toEqual({ event: 'gave_up', tries: 1, at: expect.any(String) });
    expect(count(s, 'postComment:paused')).toBe(1);
    expect(count(s, 'createRunSecretAndJob')).toBe(2);
    await h.signal(signals.cancel);
    expect((await h.result()).status).toBe('cancelled');
  });

  it('personInput between losses lets the run resume again', async () => {
    const { s, h } = await running(1);
    podEnds(s, 0);
    await waitFor(() => count(s, 'createRunSecretAndJob') === 2, 'automatic resume Job');
    await h.signal(signals.sessionStarted);
    await waitFor(() => s.statuses.at(-1)?.status === 'idle', 'idle after the automatic resume');
    await h.signal(signals.personInput);
    podEnds(s, 1);
    await waitFor(() => count(s, 'createRunSecretAndJob') === 3, 'second automatic resume Job');

    expect(s.autoResumes.map((r) => r.event)).toEqual(['resume', 'resume']);
    expect(s.autoResumes[1]).toMatchObject({ try: 1 });
    await h.signal(signals.cancel);
    expect((await h.result()).status).toBe('cancelled');
  });

  it('replay: histories from this run and the checked-in fixtures replay without nondeterminism', async () => {
    expect(Object.keys(captured).sort()).toEqual(['run-auto-resume']);
    for (const [name, h] of Object.entries(captured)) {
      const history = await h.fetchHistory();
      await Worker.runReplayHistory({ workflowsPath }, history, h.workflowId);
      if (process.env.UPDATE_REPLAY_FIXTURES === '1') {
        // Worker identities are "pid@hostname": keep machine names out of the repo.
        const json = historyToJSON(history).replace(/"identity": "[^"]*"/g, '"identity": "replay-fixture"');
        await writeFile(fixture(name), json + '\n');
      }
    }

    // Every checked-in run fixture, including those recorded before this patch existed.
    const dir = fileURLToPath(new URL('./fixtures/', import.meta.url));
    const names = (await readdir(dir)).filter((f) => /^run-.*-history\.json$/.test(f));
    expect(names.length).toBeGreaterThan(1);
    for (const file of names) {
      const json: unknown = JSON.parse(await readFile(`${dir}${file}`, 'utf8'));
      await Worker.runReplayHistory({ workflowsPath }, json, `fixture-${file}`);
    }
  });
});
