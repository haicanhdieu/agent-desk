import { createApi } from '@agentdesk/contracts/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ids } from '../dto/ids';
import { mockDb } from './db';
import {
  playSetupTest,
  rememberSetupTestScript,
  subscribeProject,
  subscribeRun,
  subscribeSetupTest,
  type RunStreamMessage,
  type SetupTestStreamMessage,
} from './live';
import { scenarios } from './scenarios';
import { DEFAULT_RUN_SCRIPT } from './stream-handlers';

const api = createApi({ baseUrl: 'http://localhost:3000', parse: true });

const run63 = () => {
  const r = mockDb.state.runs.find((x) => x.id === ids.run(1, 63));
  if (!r) throw new Error('run 63 missing');
  return r;
};

afterEach(() => {
  vi.useRealTimers();
});

describe('scripted runs', () => {
  it('the default script waits for a stream, then goes starting → running → idle with lifecycle lines', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    scenarios.runScript(DEFAULT_RUN_SCRIPT.runId, DEFAULT_RUN_SCRIPT.steps, { start: 'onStream' });
    vi.advanceTimersByTime(60_000);
    expect(run63().status).toBe('queued');

    const run: RunStreamMessage[] = [];
    const project: string[] = [];
    subscribeRun(run63().id, (m) => run.push(m));
    subscribeProject(run63().projectId, (m) => project.push(m.status));
    vi.advanceTimersByTime(60_000);

    expect(run63().status).toBe('idle');
    expect(run63().startedAt).not.toBeNull();
    expect(run63().idleSince).not.toBeNull();
    expect(project).toEqual(['starting', 'running', 'idle']);
    const statuses = run.flatMap((m) => (m.event === 'status' ? [m.data.status] : []));
    expect(statuses).toEqual(['starting', 'running', 'idle']);
    // Event messages carry their seq as id (status messages none, as the API); seqs follow the stored log.
    const stored = mockDb.state.runEvents[run63().id]?.map((e) => e.seq) ?? [];
    const sent = run.flatMap((m) => (m.event === 'event' ? [m.data.seq] : []));
    expect(sent).toEqual(stored.slice(-sent.length));
    for (const m of run)
      expect('id' in m ? m.id : undefined).toBe(m.event === 'event' ? String(m.data.seq) : undefined);
  });

  it('a run cancelled meanwhile stops the script; a reset drops it', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    scenarios.runScript(ids.run(1, 63), [{ afterMs: 1_000, status: 'starting' }]);
    run63().status = 'cancelled';
    vi.advanceTimersByTime(2_000);
    expect(run63().status).toBe('cancelled');

    scenarios.runScript(ids.run(1, 61), [{ afterMs: 1_000, status: 'idle' }]);
    mockDb.reset();
    vi.advanceTimersByTime(2_000);
    expect(mockDb.state.runs.find((r) => r.number === 61 && r.projectId === ids.project.invoicerApi)?.status).toBe(
      'running',
    );
  });
});

describe('scripted setup tests', () => {
  const P = ids.project.invoicerApi;
  const create = async (script: string) => {
    const test = await api.setupTests.create({ params: { projectId: P }, body: { script } });
    rememberSetupTestScript(test.id, script);
    return test;
  };
  const row = (id: string) => {
    const t = mockDb.state.setupTests.find((x) => x.id === id);
    if (!t) throw new Error('test missing');
    return t;
  };

  it('plays checkout, plugins, output and a pass, with the workspace open for 15 minutes', async () => {
    const test = await create('npm ci');
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const messages: SetupTestStreamMessage[] = [];
    subscribeSetupTest(test.id, (m) => messages.push(m));
    playSetupTest(test.id);
    // Playing twice does nothing more.
    playSetupTest(test.id);
    vi.advanceTimersByTime(60_000);
    expect(row(test.id)).toMatchObject({
      status: 'passed',
      exitCode: null,
      checkoutSha: expect.stringMatching(/^a91c3e2/),
    });
    expect(row(test.id).plugins).toEqual({
      installed: ['superpowers@claude-plugins-official', 'context7@claude-plugins-official'],
      skipped: ['acme-lint@acme-tools'],
      failed: [],
    });
    const kinds = (mockDb.state.setupTestEvents[test.id] ?? []).map((e) => e.payload['kind']);
    expect(kinds).toEqual([
      'checkout',
      'plugins_begin',
      'plugin_installed',
      'plugin_installed',
      'plugin_skipped',
      'plugins_end',
      'setup_begin',
      'setup_output',
      'setup_output',
      'setup_passed',
    ]);
    const final = row(test.id);
    expect(Date.parse(final.endsAt ?? '') - Date.parse(final.finishedAt ?? '')).toBe(15 * 60_000);
    expect(messages.filter((m) => m.event === 'event')).toHaveLength(kinds.length);
    expect(messages.at(-1)).toMatchObject({ event: 'status', data: { status: 'passed' } });
  });

  it('a script with `exit 1` fails; an ended test stops playing; a reset drops it', async () => {
    const failing = await create('echo hi\nexit 1\n');
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    playSetupTest(failing.id);
    vi.advanceTimersByTime(60_000);
    expect(row(failing.id)).toMatchObject({ status: 'failed', exitCode: 1 });

    vi.useRealTimers();
    const ended = await create('x');
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    playSetupTest(ended.id);
    Object.assign(row(ended.id), { status: 'ended', endedAt: new Date().toISOString() });
    vi.advanceTimersByTime(60_000);
    expect(row(ended.id).status).toBe('ended');
    expect(mockDb.state.setupTestEvents[ended.id]).toBeUndefined();

    const dropped = row(failing.id).id;
    mockDb.reset();
    expect(mockDb.state.setupTests.find((t) => t.id === dropped)).toBeUndefined();
  });
});
