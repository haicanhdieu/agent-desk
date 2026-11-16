import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// fake-pod.mjs is a script the FakeKubeGateway spawns; fake-gateway.test.ts covers it end to end as a subprocess. Here
// it is imported in-process (a fresh module per boot) with fake timers, so each branch is exercised and measured fast.
const FAKE_POD = fileURLToPath(new URL('../../src/kube/fake-pod.mjs', import.meta.url));
const TURN_MS = 1000;
const TICK_MS = 50;

class PodExit extends Error {
  constructor(readonly code: number | string | null | undefined) {
    super(`process.exit(${String(code)})`);
  }
}

let dir: string;
const argv = process.argv;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'fake-pod-test-'));
  vi.useFakeTimers();
  vi.spyOn(process, 'exit').mockImplementation((code) => {
    throw new PodExit(code);
  });
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  process.argv = argv;
  rmSync(dir, { recursive: true, force: true });
});

async function boot(env: Record<string, string> = {}, stateDir: string | null = dir): Promise<void> {
  vi.resetModules();
  for (const [k, v] of Object.entries({
    PROMPT: '',
    SETUP_SCRIPT: '',
    RUN_MODE: '',
    FAKE_TURN_MS: String(TURN_MS),
    ...env,
  })) {
    vi.stubEnv(k, v);
  }
  process.argv = stateDir === null ? [argv[0] ?? 'node', FAKE_POD] : [argv[0] ?? 'node', FAKE_POD, stateDir];
  await import(FAKE_POD);
}

const read = (name: string): string => (existsSync(join(dir, name)) ? readFileSync(join(dir, name), 'utf8') : '');
const logLines = (): string[] =>
  read('log')
    .split('\n')
    .filter((l) => l.length > 0);
const b64 = (t: string): string => Buffer.from(t, 'utf8').toString('base64');
const advance = (ms: number): void => {
  vi.advanceTimersByTime(ms);
};
const exitCodeOf = (fn: () => void): number | string | null | undefined => {
  try {
    fn();
  } catch (err) {
    if (err instanceof PodExit) return err.code;
    throw err;
  }
  throw new Error('the pod did not exit');
};
const stateLines = (): string[] => logLines().filter((l) => l.startsWith('agentdesk: state '));
const NEEDS_INPUT = `agentdesk: state needs_input declared ${b64('Fake agent is waiting')}`;
const DONE = `agentdesk: state done declared ${b64('Fake agent finished')}`;

describe('fake-pod.mjs', () => {
  it('exits 64 without a state dir', async () => {
    await expect(boot({}, null)).rejects.toMatchObject({ code: 64 });
  });

  describe('start-up', () => {
    it('logs checkout, plugins, a skipped setup and the session start, then the first turn working', async () => {
      await boot({ PROMPT: 'do the thing' });
      expect(logLines()).toEqual([
        `agentdesk: checkout ${'0'.repeat(40)}`,
        'agentdesk: plugins begin',
        'agentdesk: plugins end',
        'agentdesk: setup skipped (no script)',
        'agentdesk: session started',
        'agentdesk: state working',
      ]);
      expect(read('started')).not.toBe('');
      expect(read('pane')).toContain('Fake Claude Code');
      expect(read('pane')).toContain('do the thing');
    });

    it('writes a multi-line prompt to the pane with terminal line breaks', async () => {
      await boot({ PROMPT: 'line one\nline two' });
      expect(read('pane')).toContain('line one\r\nline two\r\n');
    });

    it('logs setup passed for a script', async () => {
      await boot({ SETUP_SCRIPT: 'npm ci' });
      expect(logLines()).toEqual(expect.arrayContaining(['agentdesk: setup begin', 'agentdesk: setup passed']));
    });

    it('exits 78 before the session when the setup script fails in a real run', async () => {
      await expect(boot({ SETUP_SCRIPT: 'x --fake-setup-fail' })).rejects.toMatchObject({ code: 78 });
      expect(read('exit')).toBe('78');
      expect(logLines()).toContain('agentdesk: setup failed exit=1');
      expect(logLines()).not.toContain('agentdesk: session started');
    });

    it('starts a setup-test session after a failed setup, with a shell pane and no turn markers', async () => {
      await boot({ RUN_MODE: 'setup_test', SETUP_SCRIPT: 'x --fake-setup-fail' });
      expect(logLines()).toEqual(
        expect.arrayContaining(['agentdesk: setup failed exit=1', 'agentdesk: session started']),
      );
      expect(read('pane')).toBe('$ ');
      advance(TURN_MS * 5);
      expect(stateLines()).toEqual([]);
    });

    it('with --fake-pending never starts, and ends when killed', async () => {
      await boot({ PROMPT: '--fake-pending' });
      expect(existsSync(join(dir, 'started'))).toBe(false);
      expect(logLines()).toEqual([]);
      advance(TICK_MS * 4); // alive
      writeFileSync(join(dir, 'kill'), '');
      expect(exitCodeOf(() => advance(TICK_MS))).toBe(0);
    });

    it('with --fake-pending ends after the max lifetime', async () => {
      await boot({ PROMPT: '--fake-pending', FAKE_MAX_LIFE_MS: '500' });
      expect(exitCodeOf(() => advance(1000))).toBe(0);
    });
  });

  describe('resume', () => {
    let volume: string;
    beforeEach(() => {
      volume = mkdtempSync(join(tmpdir(), 'fake-pod-volume-'));
    });
    afterEach(() => rmSync(volume, { recursive: true, force: true }));
    const readVolume = (name: string): string =>
      existsSync(join(volume, name)) ? readFileSync(join(volume, name), 'utf8') : '';

    it('a fresh start on a volume saves the session marker and keeps a copy of the conversation', async () => {
      await boot({ PROMPT: 'first question', FAKE_VOLUME_DIR: volume });
      expect(readVolume('session-started')).not.toBe('');
      expect(readVolume('pane')).toBe(read('pane'));
      expect(readVolume('pane')).toContain('first question');
    });

    it('exits 79 with no saved session', async () => {
      await expect(boot({ RUN_MODE: 'resume', FAKE_VOLUME_DIR: volume })).rejects.toMatchObject({ code: 79 });
      expect(read('exit')).toBe('79');
      expect(logLines()).toEqual(['agentdesk: resume failed (no saved session)']);
    });

    it('exits 79 when the pod has no volume at all', async () => {
      await expect(boot({ RUN_MODE: 'resume' })).rejects.toMatchObject({ code: 79 });
    });

    it('resumes the saved conversation: no checkout, no turn, typed input starts one', async () => {
      await boot({ PROMPT: 'first question', FAKE_VOLUME_DIR: volume });
      advance(TURN_MS);
      writeFileSync(join(dir, 'kill'), '');
      expect(exitCodeOf(() => advance(TICK_MS))).toBe(0);

      rmSync(dir, { recursive: true, force: true });
      mkdirSync(dir); // a new pod, a new state dir; only the volume carries over
      // The first pod is gone: its input timer must not stand in for the resumed pod's (it watches the same path here).
      vi.clearAllTimers();
      await boot({ RUN_MODE: 'resume', FAKE_VOLUME_DIR: volume });
      expect(logLines()).toEqual(['agentdesk: session resumed', 'agentdesk: session started']);
      expect(read('pane')).toContain('first question');
      advance(TURN_MS * 3);
      expect(stateLines()).toEqual([]);

      appendFileSync(join(dir, 'input'), 'and now\r');
      advance(TICK_MS);
      expect(read('pane')).toContain('and now');
      expect(stateLines()).toEqual(['agentdesk: state working']);
      advance(TURN_MS);
      expect(stateLines()).toEqual(['agentdesk: state working', NEEDS_INPUT]);
    });
  });

  describe('turns', () => {
    it('ends the first turn with needs_input after FAKE_TURN_MS', async () => {
      await boot();
      advance(TURN_MS - 1);
      expect(stateLines()).toEqual(['agentdesk: state working']);
      advance(1);
      expect(stateLines()).toEqual(['agentdesk: state working', NEEDS_INPUT]);
    });

    it('ends with done declared when the prompt asks for --fake-done', async () => {
      await boot({ PROMPT: '--fake-done' });
      advance(TURN_MS);
      expect(stateLines()).toEqual(['agentdesk: state working', DONE]);
    });

    it('waits on background tasks first with --fake-background', async () => {
      await boot({ PROMPT: '--fake-background' });
      expect(stateLines()).toEqual(['agentdesk: state working', 'agentdesk: state waiting background']);
      advance(TURN_MS);
      expect(stateLines()).toEqual([
        'agentdesk: state working',
        'agentdesk: state waiting background',
        'agentdesk: state working',
      ]);
      advance(TURN_MS);
      expect(stateLines().at(-1)).toBe(NEEDS_INPUT);
    });

    it('exits 3 with the scrollback after the first turn with --fake-fail', async () => {
      await boot({ PROMPT: '--fake-fail' });
      expect(exitCodeOf(() => advance(TURN_MS))).toBe(3);
      expect(read('exit')).toBe('3');
      const lines = logLines();
      expect(lines).toContain(NEEDS_INPUT);
      expect(lines.indexOf('agentdesk: final scrollback begin')).toBeGreaterThan(lines.indexOf(NEEDS_INPUT));
      // The runner's end line follows the scrollback: a crashed agent, not a lost pod.
      expect(lines.slice(-2)).toEqual([
        'agentdesk: final scrollback end',
        'agentdesk: session ended reason=agent_exit code=3',
      ]);
    });
  });

  describe('typed input', () => {
    it('echoes a typed line to the pane and runs another turn', async () => {
      await boot();
      advance(TURN_MS); // first turn over
      appendFileSync(join(dir, 'input'), 'hello\r');
      advance(TICK_MS);
      expect(read('pane')).toContain('hello\r\n');
      expect(stateLines()).toEqual(['agentdesk: state working', NEEDS_INPUT, 'agentdesk: state working']);
      advance(TURN_MS);
      expect(stateLines().at(-1)).toBe(NEEDS_INPUT);
    });

    it('queues a line typed during a turn and runs it right after', async () => {
      await boot();
      appendFileSync(join(dir, 'input'), 'one\rtwo\r');
      advance(TICK_MS);
      expect(stateLines()).toEqual(['agentdesk: state working']); // both queued behind the running turn
      advance(TURN_MS);
      expect(stateLines()).toEqual(['agentdesk: state working', NEEDS_INPUT, 'agentdesk: state working']);
      advance(TURN_MS);
      expect(stateLines()).toEqual([
        'agentdesk: state working',
        NEEDS_INPUT,
        'agentdesk: state working',
        NEEDS_INPUT,
        'agentdesk: state working',
      ]);
      advance(TURN_MS);
      expect(stateLines().filter((l) => l === NEEDS_INPUT)).toHaveLength(3);
      advance(TURN_MS * 3);
      expect(stateLines().filter((l) => l === NEEDS_INPUT)).toHaveLength(3); // nothing left queued
    });

    it('keeps a partial line until its carriage return arrives, and decodes split multi-byte characters', async () => {
      await boot();
      advance(TURN_MS);
      const bytes = Buffer.from('héllo', 'utf8');
      appendFileSync(join(dir, 'input'), bytes.subarray(0, 2)); // splits the two-byte é
      advance(TICK_MS);
      expect(read('pane')).not.toContain('h');
      appendFileSync(join(dir, 'input'), Buffer.concat([bytes.subarray(2), Buffer.from('\r')]));
      advance(TICK_MS);
      expect(read('pane')).toContain('héllo\r\n');
    });

    it('drops newlines inside a line', async () => {
      await boot();
      appendFileSync(join(dir, 'input'), 'a\nb\r');
      advance(TICK_MS);
      expect(read('pane')).toContain('ab\r\n');
    });

    it('does nothing when the input file has not grown', async () => {
      await boot();
      appendFileSync(join(dir, 'input'), 'x\r');
      advance(TICK_MS);
      const pane = read('pane');
      advance(TICK_MS * 3);
      expect(read('pane')).toBe(pane);
    });

    it('echoes at a shell prompt and starts no turn in a setup-test session', async () => {
      await boot({ RUN_MODE: 'setup_test' });
      appendFileSync(join(dir, 'input'), 'ls\r');
      advance(TICK_MS);
      expect(read('pane')).toBe('$ ls\r\n$ ');
      advance(TURN_MS * 3);
      expect(stateLines()).toEqual([]);
    });
  });

  describe('shutdown', () => {
    it('logs the scrollback and exits 0 on kill', async () => {
      await boot({ PROMPT: 'hi' });
      writeFileSync(join(dir, 'kill'), '');
      expect(exitCodeOf(() => advance(TICK_MS))).toBe(0);
      expect(read('exit')).toBe('0');
      const lines = logLines();
      const begin = lines.indexOf('agentdesk: final scrollback begin');
      expect(begin).toBeGreaterThan(0);
      expect(lines.slice(begin, -1)).toEqual(
        expect.arrayContaining([
          'agentdesk: final scrollback begin',
          expect.stringContaining('Fake Claude Code'),
          '> hi',
        ]),
      );
      expect(lines.at(-1)).toBe('agentdesk: final scrollback end');
    });

    it('exits 0 after the max lifetime', async () => {
      await boot({ FAKE_MAX_LIFE_MS: '500' });
      expect(exitCodeOf(() => advance(1000))).toBe(0);
      expect(read('exit')).toBe('0');
    });

    it('survives a kill that arrives with no pane written', async () => {
      await boot({ RUN_MODE: 'setup_test' });
      rmSync(join(dir, 'pane'));
      writeFileSync(join(dir, 'kill'), '');
      expect(exitCodeOf(() => advance(TICK_MS))).toBe(0);
      expect(logLines().slice(-2)).toEqual(['agentdesk: final scrollback begin', 'agentdesk: final scrollback end']);
    });
  });
});
