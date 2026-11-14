import type {
  PluginsDto,
  RunEventDto,
  SetupScriptDto,
  SetupScriptVersionDto,
  SetupTestDto,
} from '@agentdesk/contracts';
import { describe, expect, it } from 'vitest';
import { SETUP_SCRIPT_STARTER } from '@/screens/DeskSetup';
import { setupScriptSaveProblem, setupWarningOf, toDeskSetupProps, toSetupStepTest } from './map';

const ID = 'b0000000-0000-4000-8000-000000000001';
const PROJECT = 'a0000000-0000-4000-8000-000000000001';
/** A local-time ISO string, so HH:mm assertions hold in any time zone. */
const local = (h: number, m: number, s = 0) => new Date(2026, 10, 12, h, m, s).toISOString();
const now = new Date(2026, 10, 12, 14, 30, 0);

const script = (over: Partial<SetupScriptDto> = {}): SetupScriptDto => ({
  version: 4,
  body: 'set -e\nnpm ci\n',
  note: 'Restore tools',
  createdBy: 'kim-hale',
  createdAt: local(14, 0),
  ...over,
});
const noPlugins: PluginsDto = { approvedStores: ['claude-plugins-official'], plugins: [], settingsError: null };
const test = (over: Partial<SetupTestDto> = {}): SetupTestDto => ({
  id: ID,
  projectId: PROJECT,
  status: 'running',
  scriptSha256: 'a'.repeat(64),
  matchesCurrentScript: true,
  checkoutSha: null,
  plugins: { installed: [], skipped: [], failed: [] },
  exitCode: null,
  startedBy: 'kim-hale',
  createdAt: local(14, 22),
  finishedAt: null,
  endedAt: null,
  endsAt: null,
  ...over,
});
let seq = 0;
const ev = (ts: string, payload: Record<string, unknown>): RunEventDto => ({
  seq: ++seq,
  ts,
  type: 'lifecycle',
  payload,
});
const SHA = 'a91c3e2' + '0'.repeat(33);
const data = (over: Partial<Parameters<typeof toDeskSetupProps>[0]> = {}) => ({
  script: script(),
  versions: [] as SetupScriptVersionDto[],
  plugins: noPlugins,
  latest: null,
  events: [] as RunEventDto[],
  ...over,
});
const props = (over: Partial<Parameters<typeof toDeskSetupProps>[0]> = {}) => toDeskSetupProps(data(over), now);

describe('toDeskSetupProps', () => {
  it('no script yet: script null (the screen shows the starter text and its empty copy), no test, no history', () => {
    const p = props({ script: null });
    expect(p.script).toBeNull();
    expect(p.versions).toEqual([]);
    expect(p.lastTest).toBeUndefined();
    expect(p.test).toBeUndefined();
    expect(SETUP_SCRIPT_STARTER).toContain('set -euo pipefail');
  });

  it('the saved script: version, body, author and relative save time', () => {
    expect(props().script).toEqual({
      version: 4,
      body: 'set -e\nnpm ci\n',
      savedBy: 'kim-hale',
      savedAgo: '30 min ago',
    });
  });

  it('versions: as given (newest first) with author, relative time and the note when there is one', () => {
    const p = props({
      versions: [
        { version: 2, note: null, createdBy: 'dana-ortiz', createdAt: local(13, 0) },
        { version: 1, note: 'First', createdBy: 'kim-hale', createdAt: local(9, 0) },
      ],
    });
    expect(p.versions).toEqual([
      { version: 2, author: 'dana-ortiz', ago: '1 hour ago' },
      { version: 1, author: 'kim-hale', ago: '5 hours ago', note: 'First' },
    ]);
  });

  describe('plugins panel', () => {
    it('will_install and blocked as the repo settings give them', () => {
      const p = props({
        plugins: {
          approvedStores: ['claude-plugins-official'],
          plugins: [
            { id: 'a@claude-plugins-official', name: 'a', store: 'claude-plugins-official', state: 'will_install' },
            { id: 'b@acme', name: 'b', store: 'acme', state: 'blocked' },
          ],
          settingsError: null,
        },
      });
      expect(p.plugins).toEqual({
        plugins: [
          { id: 'a@claude-plugins-official', state: 'will_install' },
          { id: 'b@acme', state: 'blocked' },
        ],
      });
    });

    it('unreadable repo settings → an error line and no plugins', () => {
      const p = props({ plugins: { ...noPlugins, settingsError: 'unreadable' } });
      expect(p.plugins.plugins).toEqual([]);
      expect(p.plugins.error).toMatch(/\.claude\/settings\.json/);
    });
  });

  describe('last test', () => {
    // As the backend stores a pass: status passed, no exit code; ended_at set once the workspace is gone.
    const finished = {
      status: 'passed' as const,
      exitCode: null,
      checkoutSha: SHA,
      plugins: { installed: ['a@s', 'b@s'], skipped: ['c@x'], failed: [] },
      createdAt: local(14, 22, 0),
      finishedAt: local(14, 24, 41),
      endedAt: local(14, 40),
    };

    it('passed, matching the saved script (by hash): summary with who, when, how long and what ran', () => {
      const p = props({ latest: test({ ...finished, matchesCurrentScript: true }) });
      expect(p.lastTest).toEqual({
        result: 'passed',
        matchesSaved: true,
        summary: 'Today 14:22 by kim-hale, 2m 41s. Clone, 2 plugins installed, 1 blocked, setup passed.',
      });
      expect(p.test).toBeUndefined();
    });

    it('matchesSaved follows matchesCurrentScript', () => {
      expect(props({ latest: test({ ...finished, matchesCurrentScript: false }) }).lastTest?.matchesSaved).toBe(false);
    });

    it('a non-zero exit is a failed test', () => {
      const p = props({ latest: test({ ...finished, status: 'failed', exitCode: 1 }) });
      expect(p.lastTest?.result).toBe('failed');
      expect(p.lastTest?.summary).toContain('setup exited 1');
    });

    describe('the four shapes the backend stores', () => {
      const marker = (kind: string, extra: Record<string, unknown> = {}) => [
        ev(local(14, 24, 41), { kind, text: kind, ...extra }),
      ];
      const shapes = [
        {
          name: 'passed, no exit code',
          latest: { ...finished, status: 'passed' as const, exitCode: null },
          events: marker('setup_passed'),
          result: 'passed',
          view: 'passed',
          tail: 'setup passed.',
        },
        {
          name: 'no script (setup skipped), no exit code',
          latest: { ...finished, status: 'passed' as const, exitCode: null },
          events: marker('setup_skipped'),
          result: 'passed',
          view: 'passed',
          tail: 'setup skipped.',
        },
        {
          name: 'failed with an exit code',
          latest: { ...finished, status: 'failed' as const, exitCode: 3 },
          events: marker('setup_failed', { exitCode: 3 }),
          result: 'failed',
          view: 'failed',
          tail: 'setup exited 3.',
        },
        {
          name: 'timed out, no exit code',
          latest: { ...finished, status: 'failed' as const, exitCode: null },
          events: marker('setup_timed_out'),
          result: 'failed',
          view: 'failed',
          tail: 'setup timed out.',
        },
      ] as const;

      for (const shape of shapes) {
        it(`${shape.name}: banner and the ended log agree`, () => {
          const p = toDeskSetupProps(data({ latest: test(shape.latest), events: [...shape.events] }), now, {
            showEnded: true,
          });
          expect(p.lastTest?.result).toBe(shape.result);
          expect(p.lastTest?.summary.endsWith(shape.tail)).toBe(true);
          expect(p.lastTest?.summary).not.toContain('exited 0');
          expect(p.test).toMatchObject({ status: shape.view, view: 'log', endsIn: 'ended' });
        });

        it(`${shape.name}: with the test's own events missing, the status decides`, () => {
          const p = props({ latest: test(shape.latest) });
          expect(p.lastTest?.result).toBe(shape.result);
        });
      }

      it('ended without a result (status ended): the banner says so; the log shows as failed', () => {
        const latest = test({ status: 'ended', exitCode: null, finishedAt: null, endedAt: local(14, 25) });
        const p = toDeskSetupProps(data({ latest }), now, { showEnded: true });
        expect(p.lastTest).toMatchObject({ result: 'ended', matchesSaved: false });
        expect(p.lastTest?.summary).toContain('ended before setup finished');
        expect(p.test).toMatchObject({ status: 'failed', view: 'log' });
        expect(props({ latest }).test).toBeUndefined();
      });

      it('a test that passed and was later ended keeps status passed: ended, not an open workspace', () => {
        const latest = test({ ...finished, status: 'passed' });
        expect(props({ latest }).test).toBeUndefined();
        expect(props({ latest }).lastTest?.result).toBe('passed');
      });

      it('the result marker wins over the status, then the status, then finishedAt without an exit code', () => {
        const running = test({ status: 'running', exitCode: null, finishedAt: null });
        const withMarker = props({ latest: running, events: marker('setup_passed') });
        expect(withMarker.lastTest?.result).toBe('passed');
        const finishedNoStatus = test({ status: 'running', exitCode: null, finishedAt: local(14, 24, 41) });
        expect(props({ latest: finishedNoStatus }).lastTest?.result).toBe('passed');
        expect(props({ latest: running }).lastTest).toBeUndefined();
      });
    });

    it('a test ended before setup finished reports "ended", never a pass or a fail', () => {
      expect(props({ latest: test({ status: 'ended', endedAt: local(14, 25) }) }).lastTest?.result).toBe('ended');
    });

    it('no test at all: no banner data', () => {
      expect(props({ latest: null }).lastTest).toBeUndefined();
    });
  });

  describe('test workspace', () => {
    const running = test({ status: 'running', createdAt: local(14, 29, 0), checkoutSha: SHA });

    it('queued and running are "running"; passed and failed carry through; ended has no workspace', () => {
      expect(props({ latest: test({ status: 'queued' }) }).test?.status).toBe('running');
      expect(props({ latest: running }).test?.status).toBe('running');
      expect(props({ latest: test({ status: 'passed', exitCode: null }) }).test?.status).toBe('passed');
      expect(props({ latest: test({ status: 'failed', exitCode: 1 }) }).test?.status).toBe('failed');
      expect(props({ latest: test({ status: 'ended', endedAt: local(14, 25) }) }).test).toBeUndefined();
    });

    it('script label: the saved version when it matches, otherwise a draft; checkout and start time', () => {
      expect(props({ latest: running }).test).toMatchObject({
        scriptLabel: 'Version 4',
        checkout: 'a91c3e2',
        started: '14:29',
      });
      expect(props({ latest: { ...running, matchesCurrentScript: false } }).test?.scriptLabel).toBe('Draft, not saved');
      expect(props({ script: null, latest: { ...running, matchesCurrentScript: false } }).test?.scriptLabel).toBe(
        'Draft, not saved',
      );
    });

    it('ends in: minutes until endsAt (at least 0), after setup before it is known', () => {
      expect(
        props({ latest: test({ status: 'passed', exitCode: null, endsAt: local(14, 43, 10) }) }).test?.endsIn,
      ).toBe('14 min');
      expect(props({ latest: test({ status: 'passed', exitCode: null, endsAt: local(14, 20) }) }).test?.endsIn).toBe(
        '0 min',
      );
      expect(props({ latest: running }).test?.endsIn).toBe('setup finishes');
    });

    describe('phases from the events', () => {
      const begin = [
        ev(local(14, 29, 1), { kind: 'checkout', text: `agentdesk: checkout ${SHA}`, sha: SHA }),
        ev(local(14, 29, 2), { kind: 'plugins_begin', text: 'agentdesk: plugins begin' }),
        ev(local(14, 29, 3), { kind: 'plugin_installed', text: 'x', pluginId: 'a@claude-plugins-official' }),
        ev(local(14, 29, 4), { kind: 'plugin_skipped', text: 'x', pluginId: 'b@acme' }),
        ev(local(14, 29, 5), { kind: 'plugins_end', text: 'agentdesk: plugins end' }),
        ev(local(14, 29, 6), { kind: 'setup_begin', text: 'agentdesk: setup begin' }),
      ];
      const phases = (status: SetupTestDto['status'], events: RunEventDto[], exitCode: number | null = null) =>
        props({ latest: test({ status, exitCode, checkoutSha: null }), events }).test?.phases;

      it('nothing yet: the clone is in progress, the rest pending', () => {
        expect(phases('queued', [])).toEqual([
          { label: 'Clone', state: 'active' },
          { label: 'Plugins', state: 'pending' },
          { label: 'Setup', state: 'pending' },
          { label: 'Shell', state: 'pending' },
        ]);
      });

      it('checkout marks the clone done with its short sha', () => {
        expect(phases('running', begin.slice(0, 1))?.[0]).toEqual({ label: 'Clone', state: 'done', detail: 'a91c3e2' });
        expect(phases('running', begin.slice(0, 1))?.[1]).toEqual({ label: 'Plugins', state: 'active' });
      });

      it('plugins end → counts of installed and blocked; setup begin → setup in progress with its running time', () => {
        expect(phases('running', begin)).toEqual([
          { label: 'Clone', state: 'done', detail: 'a91c3e2' },
          { label: 'Plugins', state: 'done', detail: '1 installed, 1 blocked' },
          { label: 'Setup', state: 'active', detail: 'running for 54s' },
          { label: 'Shell', state: 'pending' },
        ]);
      });

      it('setup passed → ✓ with exit 0 and how long it took; the shell is ready', () => {
        const events = [...begin, ev(local(14, 31, 37), { kind: 'setup_passed', text: 'agentdesk: setup passed' })];
        const p = phases('passed', events, 0);
        expect(p?.[2]).toEqual({ label: 'Setup', state: 'done', detail: 'exit 0 after 2m 31s' });
        expect(p?.[3]).toEqual({ label: 'Shell', state: 'done', detail: 'ready for you' });
      });

      it('setup failed → ✗ with the exit code and time under a minute', () => {
        const events = [
          ...begin,
          ev(local(14, 29, 54), { kind: 'setup_failed', text: 'agentdesk: setup failed exit=1', exitCode: 1 }),
        ];
        const p = phases('failed', events, 1);
        expect(p?.[2]).toEqual({ label: 'Setup', state: 'failed', detail: 'exit 1 after 48s' });
        expect(p?.[3]).toEqual({ label: 'Shell', state: 'done', detail: 'ready for you' });
      });

      it('setup timed out → ✗', () => {
        const events = [...begin, ev(local(14, 39, 6), { kind: 'setup_timed_out', text: 'x' })];
        expect(phases('failed', events)?.[2]).toEqual({
          label: 'Setup',
          state: 'failed',
          detail: 'timed out after 10m 0s',
        });
      });

      it('no script saved: setup skipped', () => {
        const events = [
          begin[0] as RunEventDto,
          ev(local(14, 29, 6), { kind: 'setup_skipped', text: 'agentdesk: setup skipped (no script)' }),
        ];
        expect(phases('passed', events, 0)?.[2]).toEqual({ label: 'Setup', state: 'done', detail: 'no script' });
      });

      it('a test that failed before its clone finished marks the clone failed', () => {
        expect(phases('failed', [])?.[0]).toEqual({ label: 'Clone', state: 'failed' });
      });

      it('events with an unknown shape are ignored', () => {
        const events = [ev(local(14, 29), { kind: 'nonsense' }), ev(local(14, 29), { text: 5 }), ev(local(14, 29), {})];
        expect(phases('queued', events)?.[0]).toEqual({ label: 'Clone', state: 'active' });
      });
    });

    describe('plugins of this test', () => {
      it('what each plugin did, from the events and the test, once each', () => {
        const events = [
          ev(local(14, 29, 3), { kind: 'plugin_installed', text: 'x', pluginId: 'a@s' }),
          ev(local(14, 29, 4), { kind: 'plugin_skipped', text: 'x', pluginId: 'b@x' }),
          ev(local(14, 29, 5), { kind: 'plugin_failed', text: 'x', pluginId: 'c@s' }),
        ];
        const p = props({
          latest: test({ plugins: { installed: ['a@s'], skipped: ['b@x'], failed: ['c@s', 'd@s'] } }),
          events,
        });
        expect(p.test?.plugins).toEqual([
          { id: 'a@s', state: 'installed' },
          { id: 'b@x', state: 'skipped' },
          { id: 'c@s', state: 'failed' },
          { id: 'd@s', state: 'failed' },
        ]);
      });
    });

    describe('log lines', () => {
      it('markers as accent lines, output chunks split into lines, escapes and controls dropped', () => {
        const events = [
          ev(local(14, 29, 1), { kind: 'checkout', text: `agentdesk: checkout ${SHA}`, sha: SHA }),
          ev(local(14, 29, 2), { kind: 'plugin_installed', text: 'agentdesk: plugin installed a@s', pluginId: 'a@s' }),
          ev(local(14, 29, 3), { kind: 'plugin_skipped', text: 'agentdesk: plugin skipped b@x (store not approved)' }),
          ev(local(14, 29, 4), { kind: 'plugin_failed', text: 'agentdesk: plugin failed c@s' }),
          ev(local(14, 29, 5), {
            kind: 'setup_output',
            text: '+ npm ci\n\u001b[31mnpm ERR\u001b[0m\u0007\n',
            truncated: false,
          }),
          ev(local(14, 29, 6), { kind: 'plugin_output', text: 'plugin says hi', truncated: true }),
        ];
        const lines = props({ latest: test(), events }).test?.lines;
        expect(lines).toEqual([
          [{ text: `agentdesk: checkout ${SHA}`, tone: 'accent' }],
          [{ text: 'agentdesk: plugin installed a@s', tone: 'green' }],
          [{ text: 'agentdesk: plugin skipped b@x (store not approved)', tone: 'yellow' }],
          [{ text: 'agentdesk: plugin failed c@s', tone: 'red' }],
          [{ text: '+ npm ci' }],
          [{ text: 'npm ERR' }],
          [{ text: 'plugin says hi' }],
          [{ text: '[output truncated]', tone: 'dim' }],
        ]);
      });

      it('a failed setup line is red', () => {
        const events = [
          ev(local(14, 29), { kind: 'setup_failed', text: 'agentdesk: setup failed exit=1', exitCode: 1 }),
        ];
        expect(props({ latest: test(), events }).test?.lines).toEqual([
          [{ text: 'agentdesk: setup failed exit=1', tone: 'red' }],
        ]);
      });
    });
  });

  it('an ended test shown as a log: view "log", ended', () => {
    const p = toDeskSetupProps(
      data({ latest: test({ status: 'passed', exitCode: null, endedAt: local(14, 25) }) }),
      now,
      {
        showEnded: true,
      },
    );
    expect(p.test).toMatchObject({ status: 'passed', view: 'log', endsIn: 'ended' });
  });
});

describe('setupScriptSaveProblem', () => {
  const ok = (s: string) => setupScriptSaveProblem(s, '');
  /** "é" is two bytes in UTF-8, so 32768 of them are exactly the 64 KiB limit. */
  const exactly = 'é'.repeat(32768);

  it('accepts a script of exactly 65536 bytes, multi-byte characters included', () => {
    expect(new TextEncoder().encode(exactly).length).toBe(65536);
    expect(ok(exactly)).toBeUndefined();
  });

  it('rejects 65537 bytes with the contract message, though it is fewer than 65537 characters', () => {
    const over = `${exactly}a`;
    expect(new TextEncoder().encode(over).length).toBe(65537);
    expect(over.length).toBeLessThan(65537);
    expect(ok(over)).toBe('Setup script is larger than 64 KiB');
  });

  it('rejects a change note over 200 characters', () => {
    expect(setupScriptSaveProblem('x', 'n'.repeat(201))).toMatch(/200/);
    expect(setupScriptSaveProblem('x', 'n'.repeat(200))).toBeUndefined();
  });
});

describe('setupWarningOf', () => {
  const done = (over: Partial<SetupTestDto> = {}) =>
    test({ status: 'passed', finishedAt: local(14, 23), endedAt: local(14, 40), ...over });

  it('has nothing to warn about without a saved script, even after a failed draft test', () => {
    expect(setupWarningOf(null, null)).toBeUndefined();
    expect(setupWarningOf(null, done({ status: 'failed', exitCode: 1 }))).toBeUndefined();
  });

  it('warns when the latest test failed', () => {
    expect(setupWarningOf(script(), done({ status: 'failed', exitCode: 1 }))?.kind).toBe('failed');
  });

  it('does not blame the saved script for a failed test of an unsaved draft', () => {
    const draftFailed = done({ status: 'failed', exitCode: 1, matchesCurrentScript: false });
    expect(setupWarningOf(script(), draftFailed)?.kind).toBe('untested');
  });

  it('treats an empty saved script as no script', () => {
    expect(setupWarningOf(script({ body: '' }), null)).toBeUndefined();
    expect(setupWarningOf(script({ body: '' }), done({ status: 'failed', exitCode: 1 }))).toBeUndefined();
  });

  it('reads a failure from status, not from an exit code of 0', () => {
    expect(setupWarningOf(script(), done({ status: 'failed', exitCode: 0 }))?.kind).toBe('failed');
    expect(setupWarningOf(script(), done({ status: 'passed', exitCode: 1 }))).toBeUndefined();
  });

  it('is quiet when the latest passing test matches the saved script, ended or not', () => {
    expect(setupWarningOf(script(), done())).toBeUndefined();
    expect(setupWarningOf(script(), done({ endedAt: null }))).toBeUndefined();
  });

  it('warns when the script changed since the last passing test', () => {
    expect(setupWarningOf(script(), done({ matchesCurrentScript: false }))?.kind).toBe('changed');
  });

  it('warns when a saved script was never tested, or its latest test has no result', () => {
    expect(setupWarningOf(script(), null)?.kind).toBe('untested');
    expect(setupWarningOf(script(), test({ status: 'ended', endedAt: local(14, 25) }))?.kind).toBe('untested');
  });
});

describe('toSetupStepTest', () => {
  it('is idle without an open test', () => {
    expect(toSetupStepTest({})).toEqual({ state: 'idle' });
  });

  it('shows a running test with the phase it is in', () => {
    const view = toDeskSetupProps(
      { script: script(), versions: [], plugins: noPlugins, latest: test(), events: [] },
      now,
    );
    expect(toSetupStepTest(view)).toMatchObject({ state: 'running', detail: expect.stringContaining('Clone') });
  });

  it('shows a settled test as passed or failed with the last-test summary', () => {
    const latest = test({ status: 'failed', exitCode: 1, finishedAt: local(14, 23), checkoutSha: SHA });
    const view = toDeskSetupProps({ script: script(), versions: [], plugins: noPlugins, latest, events: [] }, now);
    expect(toSetupStepTest(view)).toMatchObject({ state: 'failed', title: 'Setup failed' });
  });
});

describe('a failed setup explains itself', () => {
  const failedRun = (exitCode: number, output: string) =>
    props({
      script: script({ body: '#!/usr/bin/env bash\nset -e\necho hi\nsudo apt-get update\n' }),
      latest: test({ status: 'failed', exitCode, finishedAt: local(14, 23), checkoutSha: SHA }),
      events: [
        ev(local(14, 22, 10), { kind: 'setup_begin', text: 'agentdesk: setup begin' }),
        ev(local(14, 22, 11), { kind: 'setup_output', text: output, truncated: false }),
        ev(local(14, 22, 12), { kind: 'setup_failed', text: `agentdesk: setup failed exit=${exitCode}`, exitCode }),
      ],
    });

  it('names the exit code, quotes the failing script line and the error output', () => {
    const p = failedRun(127, '/tmp/tmp.U1RRh1KlsN: line 4: sudo: command not found\n');
    expect(p.test?.failure).toEqual({
      title: 'Setup script failed: exit 127 (command not found)',
      detail: 'Line 4 of the script: sudo apt-get update. Output: sudo: command not found',
    });
  });

  it('shows the script as "setup script, line N" instead of the runner temp path', () => {
    const p = failedRun(127, '/tmp/tmp.U1RRh1KlsN: line 4: sudo: command not found\n');
    const text = p.test?.lines.map((l) => l.map((x) => x.text).join('')).join('\n');
    expect(text).toContain('setup script, line 4: sudo: command not found');
    expect(text).not.toContain('/tmp/tmp.');
  });

  it('without a line number, still gives the exit meaning; the draft script is not quoted when it differs', () => {
    const p = failedRun(1, 'npm ERR! missing script\n');
    expect(p.test?.failure?.title).toBe('Setup script failed: exit 1');
    expect(p.test?.failure?.detail).toBe('Output: npm ERR! missing script');
    const draft = props({
      latest: test({ status: 'failed', matchesCurrentScript: false, finishedAt: local(14, 23) }),
      events: [
        ev(local(14, 22, 11), { kind: 'setup_output', text: 'x: line 2: boom\n', truncated: false }),
        ev(local(14, 22, 12), { kind: 'setup_failed', text: 'agentdesk: setup failed exit=2', exitCode: 2 }),
      ],
    });
    expect(draft.test?.failure?.detail).not.toContain('of the script:');
  });

  it('a passing or running test has no failure summary', () => {
    expect(props({ latest: test({ status: 'running' }) }).test?.failure).toBeUndefined();
  });
});
