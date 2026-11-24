import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
  existsSync,
} from 'node:fs';
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
    // The launch line reads these; a shell that sets them must not leak in.
    AGENT_MODEL: '',
    ANTHROPIC_BASE_URL: '',
    RUN_AUTHOR_NAME: '',
    RUN_AUTHOR_EMAIL: '',
    RESUME_NOTE: '',
    FAKE_VOLUME_DIR: '',
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

  describe('launch line', () => {
    it('logs the launch line first, with the address origin', async () => {
      await boot({
        AGENT_MODEL: 'haiku',
        ANTHROPIC_BASE_URL: 'https://gateway.harbor-labs.com/v1/anthropic',
      });
      expect(logLines()[0]).toBe('agentdesk: agent claude model haiku endpoint https://gateway.harbor-labs.com');
    });

    it('logs endpoint default without an address', async () => {
      await boot({ AGENT_MODEL: 'haiku' });
      expect(logLines()[0]).toBe('agentdesk: agent claude model haiku endpoint default');
    });

    it('logs endpoint default for an address that does not parse', async () => {
      await boot({ AGENT_MODEL: 'haiku', ANTHROPIC_BASE_URL: 'not a url' });
      expect(logLines()[0]).toBe('agentdesk: agent claude model haiku endpoint default');
    });

    it('logs model default without a model', async () => {
      await boot({});
      expect(logLines()[0]).toBe('agentdesk: agent claude model default endpoint default');
    });

    it.each([
      ['a host and a port', 'https://gw.example.com:8443/p', 'https://gw.example.com:8443'],
      ['a default port, kept as typed', 'https://GW.example.com:443/x', 'https://GW.example.com:443'],
      ['userinfo with a port (never printed)', 'https://u:secret@gw.example.com:8443/p', 'default'],
      ['userinfo before a scheme', 'k:sec@https://h.example.com', 'default'],
      ['an odd scheme', '1ttp://h.example.com', 'default'],
      ['a scheme with odd characters', 'ht tp://h.example.com', 'default'],
      ['a slash inside the userinfo', 'https://u:pa/ss@h.example.com', 'default'],
      ['an empty host', 'https:///p', 'default'],
      ['@ in the path', 'https://h.example.com/a@b', 'https://h.example.com'],
      ['@ in the query', 'https://h.example.com?x@y', 'https://h.example.com'],
      ['@ in the fragment', 'https://h.example.com#x@y', 'https://h.example.com'],
      ['IPv6 brackets with a port', 'https://[::1]:8443/x', 'https://[::1]:8443'],
      ['uppercase scheme and host', 'HTTPS://Gw.Example.com/p', 'HTTPS://Gw.Example.com'],
      ['no ://', 'gw.example.com/v1', 'default'],
      ['an underscore in the host', 'https://gw_1.example.com/p', 'https://gw_1.example.com'],
    ])('prints the address like the runner does: %s', async (_n, url, endpoint) => {
      await boot({ ANTHROPIC_BASE_URL: url });
      expect(logLines()[0]).toBe(`agentdesk: agent claude model default endpoint ${endpoint}`);
    });

    it('replaces control characters in the model with ?, so it cannot forge a marker line', async () => {
      await boot({ AGENT_MODEL: 'a\rb\nagentdesk: state running\x1b[31mx' });
      expect(logLines().filter((l) => l.includes('agentdesk: agent '))).toEqual([
        'agentdesk: agent claude model a?b?agentdesk:?state?running?[31mx endpoint default',
      ]);
      expect(stateLines()).not.toContain('agentdesk: state running');
    });

    it('replaces C1 control characters and other characters outside the model id alphabet', async () => {
      await boot({ AGENT_MODEL: 'a\u009bb c d' });
      expect(logLines()[0]).toMatch(/^agentdesk: agent claude model a\?+b\?+c\?d endpoint default$/);
    });

    it('never prints credentials from the address or the API key', async () => {
      await boot({
        ANTHROPIC_BASE_URL: 'https://u:secret@gw.example.com:8443/p?k=secret',
        ANTHROPIC_API_KEY: 'sk-ant-xyz',
      });
      const line = logLines()[0];
      expect(line).toBe('agentdesk: agent claude model default endpoint default');
      expect(read('log')).not.toContain('secret');
      expect(read('log')).not.toContain('sk-ant-xyz');
    });

    it('prints a model with $() neutralised, never evaluated', async () => {
      await boot({ AGENT_MODEL: '$(touch pwned) y' });
      expect(logLines()[0]).toBe('agentdesk: agent claude model ??touch?pwned??y endpoint default');
    });

    it.each(['sonnet[1m]', 'vendor/model', 'arn:aws:bedrock:us-east-1:1:model/x.y_z+1@2-3'])(
      'prints the model id %s unchanged',
      async (model) => {
        await boot({ AGENT_MODEL: model });
        expect(logLines()[0]).toBe(`agentdesk: agent claude model ${model} endpoint default`);
      },
    );

    it('prints no launch line in setup_test mode, where no agent starts', async () => {
      await boot({ RUN_MODE: 'setup_test', AGENT_MODEL: 'opus' });
      expect(logLines().filter((l) => l.startsWith('agentdesk: agent '))).toEqual([]);
    });

    it('a resumed pod logs the launch line first too', async () => {
      const vol = join(dir, 'vol');
      mkdirSync(vol);
      writeFileSync(join(vol, 'session-started'), 'x');
      await boot({
        RUN_MODE: 'resume',
        FAKE_VOLUME_DIR: vol,
        AGENT_MODEL: 'opus',
        ANTHROPIC_BASE_URL: 'https://gateway.harbor-labs.com/v1/anthropic',
      });
      expect(logLines()[0]).toBe('agentdesk: agent claude model opus endpoint https://gateway.harbor-labs.com');
    });
  });

  describe('start-up', () => {
    it('logs checkout, plugins, a skipped setup and the session start, then the first turn working', async () => {
      await boot({ PROMPT: 'do the thing' });
      expect(logLines()).toEqual([
        'agentdesk: agent claude model default endpoint default',
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
      expect(logLines()).toEqual([
        'agentdesk: agent claude model default endpoint default',
        'agentdesk: resume failed (no saved session)',
      ]);
    });

    it('exits 79 when the pod has no volume at all', async () => {
      await expect(boot({ RUN_MODE: 'resume' })).rejects.toMatchObject({ code: 79 });
    });

    describe('RESUME_NOTE', () => {
      const saveSession = async (): Promise<string> => {
        await boot({ PROMPT: 'first question', FAKE_VOLUME_DIR: volume });
        advance(TURN_MS);
        const saved = readVolume('pane');
        writeFileSync(join(dir, 'kill'), '');
        expect(exitCodeOf(() => advance(TICK_MS))).toBe(0);
        rmSync(dir, { recursive: true, force: true });
        mkdirSync(dir);
        vi.clearAllTimers();
        return saved;
      };

      it('a resume with a note ends the pane with the note after the replayed content', async () => {
        const saved = await saveSession();
        await boot({ RUN_MODE: 'resume', FAKE_VOLUME_DIR: volume, RESUME_NOTE: 'Agent Desk: note 1' });
        expect(read('pane')).toBe(`${saved}Agent Desk: note 1\r\n`);
      });

      it('a resume without a note leaves the pane equal to the saved pane', async () => {
        const saved = await saveSession();
        await boot({ RUN_MODE: 'resume', FAKE_VOLUME_DIR: volume });
        expect(read('pane')).toBe(saved);
      });

      it('a resume with no saved session writes no note', async () => {
        await expect(
          boot({ RUN_MODE: 'resume', FAKE_VOLUME_DIR: volume, RESUME_NOTE: 'Agent Desk: note 1' }),
        ).rejects.toMatchObject({ code: 79 });
        expect(read('pane')).toBe('');
      });
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
      expect(logLines()).toEqual([
        'agentdesk: agent claude model default endpoint default',
        'agentdesk: session resumed',
        'agentdesk: session started',
      ]);
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

    it('a stop marker logs the scrollback, then the runner end line reason=stop_request code=0, and exits 0', async () => {
      await boot({ PROMPT: 'hi' });
      writeFileSync(join(dir, 'stop'), '');
      expect(exitCodeOf(() => advance(TICK_MS))).toBe(0);
      expect(read('exit')).toBe('0');
      const lines = logLines();
      expect(lines.at(-1)).toBe('agentdesk: session ended reason=stop_request code=0');
      expect(lines.at(-2)).toBe('agentdesk: final scrollback end');
      expect(lines).toContain('> hi');
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
  describe('transcript through the real adapter', () => {
    const ADAPTER = fileURLToPath(new URL('../../../../images/runner/agents/claude/transcript.mjs', import.meta.url));
    const PROMPT = 'Write the report';
    const vol = (): string => join(dir, 'vol');
    const tEnv = (extra: Record<string, string> = {}): Record<string, string> => ({
      FAKE_VOLUME_DIR: vol(),
      FAKE_TRANSCRIPT_ADAPTER: ADAPTER,
      PROMPT,
      ...extra,
    });
    type Wire = { id: string; kind: string; text: string; tool?: string; truncated?: boolean };
    const decode = (l: string): Wire =>
      JSON.parse(Buffer.from(l.slice('agentdesk: transcript '.length), 'base64').toString('utf8')) as Wire;
    const wires = (): Wire[] =>
      logLines()
        .filter((l) => l.startsWith('agentdesk: transcript '))
        .map(decode);
    const pair = (w: Wire): [string, string] => [w.kind, w.text];
    const sessionFile = (): string => {
      const proj = join(vol(), 'home', '.claude', 'projects');
      const sub = readdirSync(proj)[0] ?? '';
      const f = readdirSync(join(proj, sub)).find((n) => n.endsWith('.jsonl')) ?? '';
      return join(proj, sub, f);
    };

    it('a fresh run sends the prompt and the first reply as transcript lines', async () => {
      await boot(tEnv());
      advance(TURN_MS);
      expect(wires().map(pair)).toEqual([
        ['user', PROMPT],
        ['agent', 'Fake agent reply 1'],
      ]);
    });

    it('a resumed pod continues the same session file and sends only new entries', async () => {
      await boot(tEnv());
      advance(TURN_MS);
      const before = wires().length;
      const file = sessionFile();
      vi.clearAllTimers(); // the first pod is gone
      await boot(tEnv({ RUN_MODE: 'resume' }));
      expect(wires()).toHaveLength(before);
      appendFileSync(join(dir, 'input'), 'again\r');
      advance(TICK_MS);
      advance(TURN_MS);
      expect(sessionFile()).toBe(file);
      expect(wires().slice(before).map(pair)).toEqual([
        ['user', 'again'],
        ['agent', 'Fake agent reply 2'],
      ]);
    });

    it('stop runs the end flush before the scrollback', async () => {
      await boot(tEnv({ PROMPT: `${PROMPT} --fake-unflushed` }));
      advance(TURN_MS);
      appendFileSync(join(dir, 'input'), 'again\r');
      advance(TICK_MS);
      expect(wires().map((w) => w.text)).not.toContain('UNFLUSHED-MARKER');
      writeFileSync(join(dir, 'stop'), '');
      expect(exitCodeOf(() => advance(TICK_MS))).toBe(0);
      const lines = logLines();
      expect(wires().map((w) => w.text)).toContain('UNFLUSHED-MARKER');
      const lastWire = lines
        .map((l, i) => (l.startsWith('agentdesk: transcript ') ? i : -1))
        .reduce((a, b) => Math.max(a, b));
      expect(lastWire).toBeLessThan(lines.indexOf('agentdesk: final scrollback begin'));
    });

    it('no adapter file, an empty variable or --fake-no-transcript sends nothing', async () => {
      await boot(tEnv({ FAKE_TRANSCRIPT_ADAPTER: join(dir, 'missing.mjs') }));
      advance(TURN_MS);
      expect(wires()).toEqual([]);
      expect(existsSync(join(vol(), 'home'))).toBe(false);
      rmSync(vol(), { recursive: true, force: true });
      rmSync(join(dir, 'log'), { force: true });
      await boot(tEnv({ FAKE_TRANSCRIPT_ADAPTER: '' }));
      advance(TURN_MS);
      expect(wires()).toEqual([]);
      expect(existsSync(join(vol(), 'home'))).toBe(false);
      await boot(tEnv({ PROMPT: `${PROMPT} --fake-no-transcript` }));
      advance(TURN_MS);
      expect(wires()).toEqual([]);
    });

    it('--fake-thinking keeps the thinking block out of the transcript', async () => {
      await boot(tEnv({ PROMPT: `${PROMPT} --fake-thinking` }));
      advance(TURN_MS);
      expect(readFileSync(sessionFile(), 'utf8')).toContain('THINKING-MARKER');
      expect(JSON.stringify(wires())).not.toContain('THINKING-MARKER');
      expect(wires().map((w) => w.text)).toContain('Fake agent reply 1');
    });

    it('--fake-tools sends tool steps with their summaries and no tool output', async () => {
      await boot(tEnv({ PROMPT: `${PROMPT} --fake-tools` }));
      advance(TURN_MS);
      const tools = wires().filter((w) => w.kind === 'tool');
      expect(tools.map((w) => w.tool)).toEqual(['Bash', 'Edit', 'Write', 'Read', 'Grep', 'Grep']);
      expect(tools[0]?.text).toBe('dotnet test');
      expect(tools.slice(4).map((w) => w.text.length)).toEqual([200, 200]);
      expect(readFileSync(sessionFile(), 'utf8')).toContain('OUTPUT-MARKER');
      expect(JSON.stringify(wires())).not.toContain('OUTPUT-MARKER');
    });

    it('--fake-long-replies sends an 8,000-byte reply whole and cuts the 8,001-byte one', async () => {
      await boot(tEnv({ PROMPT: `${PROMPT} --fake-long-replies` }));
      advance(TURN_MS);
      const long = wires().filter((w) => w.kind === 'agent' && w.text.length >= 7999);
      expect(long.map((w) => [Buffer.byteLength(w.text), w.truncated === true])).toEqual([
        [8000, false],
        [8000, true],
      ]);
    });

    it('--fake-api-error sends the error as a notice and ends like --fake-fail', async () => {
      await boot(tEnv({ PROMPT: `${PROMPT} --fake-api-error` }));
      expect(exitCodeOf(() => advance(TURN_MS))).toBe(3);
      expect(wires().map(pair)).toContainEqual(['notice', 'API Error: 401 invalid credential']);
      expect(logLines().at(-1)).toBe('agentdesk: session ended reason=agent_exit code=3');
    });

    it('--fake-transcript-bulk=<n> sends exactly n entries in one flush at the first turn end', async () => {
      await boot(tEnv({ PROMPT: `${PROMPT} --fake-transcript-bulk=25` }));
      expect(wires()).toEqual([]);
      advance(TURN_MS);
      const all = wires();
      expect(all).toHaveLength(25);
      expect(all[0]?.text).toContain(PROMPT);
      expect(all[24]?.text).toBe('bulk reply 24');
    });

    it('--fake-unflushed appends its reply after the typed line is sent, unflushed', async () => {
      await boot(tEnv({ PROMPT: `${PROMPT} --fake-unflushed` }));
      advance(TURN_MS);
      expect(readFileSync(sessionFile(), 'utf8')).not.toContain('UNFLUSHED-MARKER');
      appendFileSync(join(dir, 'input'), 'MID-TURN\r');
      advance(TICK_MS);
      expect(readFileSync(sessionFile(), 'utf8')).toContain('UNFLUSHED-MARKER');
      expect(wires().map((w) => w.text)).toContain('MID-TURN');
      expect(wires().map((w) => w.text)).not.toContain('UNFLUSHED-MARKER');
    });

    it('--fake-unflushed holds the turn of the typed line open until release-turn, so no flush sends the marker', async () => {
      await boot(tEnv({ PROMPT: `${PROMPT} --fake-unflushed` }));
      advance(TURN_MS);
      appendFileSync(join(dir, 'input'), 'MID-TURN\r');
      advance(TICK_MS);
      advance(TURN_MS * 3);
      expect(wires().map((w) => w.text)).not.toContain('UNFLUSHED-MARKER');
      writeFileSync(join(dir, 'release-turn'), '');
      advance(TURN_MS);
      expect(wires().map((w) => w.text)).toContain('UNFLUSHED-MARKER');
    });

    it('--fake-bad-transcript-lines logs three malformed lines to the log and the pane', async () => {
      await boot(tEnv({ PROMPT: `${PROMPT} --fake-bad-transcript-lines` }));
      const bodies = logLines()
        .filter((l) => l.startsWith('agentdesk: transcript '))
        .map((l) => l.slice('agentdesk: transcript '.length));
      expect(bodies.map((b) => b.length)).toContain(12001);
      expect(bodies).toContain('!!!');
      expect(bodies).toContain(b64('{"id":"a b","kind":"agent","text":"x"}'));
      expect(read('pane')).toContain('agentdesk: transcript !!!');
    });
  });

  describe('lifecycle controls', () => {
    it('hold-start logs session started only after release-start', async () => {
      await boot({ PROMPT: 'p --fake-hold-start' });
      advance(TURN_MS * 3);
      expect(logLines()).toContain('agentdesk: setup skipped (no script)');
      expect(logLines()).not.toContain('agentdesk: session started');
      expect(stateLines()).toEqual([]);
      writeFileSync(join(dir, 'release-start'), '');
      advance(TICK_MS);
      expect(logLines()).toContain('agentdesk: session started');
      advance(TURN_MS);
      expect(stateLines()).toContain(NEEDS_INPUT);
    });

    it('slow-end ends only after release-end', async () => {
      await boot({ PROMPT: 'p --fake-slow-end' });
      writeFileSync(join(dir, 'stop'), '');
      advance(TURN_MS * 3);
      expect(existsSync(join(dir, 'exit'))).toBe(false);
      expect(read('log')).not.toContain('final scrollback');
      writeFileSync(join(dir, 'release-end'), '');
      expect(exitCodeOf(() => advance(TICK_MS))).toBe(0);
      expect(logLines().at(-1)).toBe('agentdesk: session ended reason=stop_request code=0');
    });

    it('hang-on-stop ignores stop and ends on kill', async () => {
      await boot({ PROMPT: 'p --fake-hang-on-stop' });
      writeFileSync(join(dir, 'stop'), '');
      advance(TURN_MS * 3);
      expect(existsSync(join(dir, 'exit'))).toBe(false);
      writeFileSync(join(dir, 'kill'), '');
      expect(exitCodeOf(() => advance(TICK_MS))).toBe(0);
      expect(read('log')).not.toContain('session ended');
    });

    it('exit-ok ends with session ended reason=agent_exit code=0', async () => {
      await boot({ PROMPT: 'p --fake-exit-ok' });
      expect(exitCodeOf(() => advance(TURN_MS))).toBe(0);
      expect(logLines().at(-1)).toBe('agentdesk: session ended reason=agent_exit code=0');
      expect(read('exit')).toBe('0');
    });

    it('hardkill exits 137 with no end flush, no scrollback and no end line', async () => {
      await boot({ PROMPT: 'p' });
      writeFileSync(join(dir, 'hardkill'), '');
      expect(exitCodeOf(() => advance(TICK_MS))).toBe(137);
      expect(read('exit')).toBe('137');
      expect(read('log')).not.toContain('final scrollback');
      expect(read('log')).not.toContain('session ended');
      expect(read('log')).not.toContain('agentdesk: transcript');
    });
  });
});
