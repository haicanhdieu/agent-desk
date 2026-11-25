import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { collectExports, mapEntry, rowsOf, sendExport } from '../agents/opencode/transcript.mjs';

const script = join(import.meta.dirname, '..', 'agents', 'opencode', 'transcript.mjs');
const stubs = join(import.meta.dirname, 'stubs');
const fixtureFile = join(import.meta.dirname, 'fixtures', 'opencode-transcript', 'session.json');
const SESSION = 'ses_001';
const iso = (ms: number) => new Date(ms).toISOString();

interface Wire {
  id: string;
  at?: string;
  kind: string;
  text: string;
  tool?: string;
  truncated?: boolean;
}

let home: string;
let stateDir: string;
let out: string;
let fixture: string;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'opencode-transcript-'));
  stateDir = join(home, '.agentdesk');
  out = join(home, 'out.log');
  fixture = await readFile(fixtureFile, 'utf8');
});

const decode = (line: string): Wire =>
  JSON.parse(Buffer.from(line.replace('agentdesk: transcript ', ''), 'base64').toString('utf8')) as Wire;
const sent = async (): Promise<Wire[]> =>
  existsSync(out)
    ? (await readFile(out, 'utf8'))
        .split('\n')
        .filter(Boolean)
        .map((l) => {
          expect(l.startsWith('agentdesk: transcript ')).toBe(true);
          return decode(l);
        })
    : [];

describe('opencode transcript adapter', () => {
  // The fixture is a real `opencode session export <id>` (CLI 2.4.1, scrubbed): { info, messages }, a user message, an
  // assistant message with a tool part (state.input), an assistant text message and an idle marker.
  it('turns the recorded session export into a user row, a tool row and an agent row', async () => {
    sendExport({ id: SESSION, text: fixture, stateDir, out });
    expect(await sent()).toEqual([
      { id: `${SESSION}:msg_002`, at: iso(1795608094577), kind: 'user', text: 'say hi using bash' },
      { id: `${SESSION}:msg_003:0`, at: iso(1795608094586), kind: 'tool', tool: 'bash', text: 'echo hi' },
      { id: `${SESSION}:msg_004`, at: iso(1795608094692), kind: 'agent', text: 'All done.' },
    ]);
  });

  it('reads the rows of the whole-JSON export, and nothing from other shapes', () => {
    const whole = JSON.parse(fixture) as { info: unknown; messages: unknown[] };
    expect(rowsOf(fixture)).toEqual(whole.messages);
    expect(rowsOf('not json')).toEqual([]);
    expect(rowsOf('{"info":{}}')).toEqual([]);
    expect(rowsOf('[1]')).toEqual([]);
  });

  it('never resends, and sends a message that appeared since', async () => {
    sendExport({ id: SESSION, text: fixture, stateDir, out });
    sendExport({ id: SESSION, text: fixture, stateDir, out });
    expect(await sent()).toHaveLength(3);
    const whole = JSON.parse(fixture) as { messages: unknown[] };
    whole.messages.push({
      id: 'msg_006',
      time: { created: 1795608094800, completed: 1795608094900 },
      type: 'assistant',
      content: [{ type: 'text', text: 'More' }],
    });
    sendExport({ id: SESSION, text: JSON.stringify(whole), stateDir, out });
    expect((await sent()).map((e) => e.text)).toEqual(['say hi using bash', 'echo hi', 'All done.', 'More']);
  });

  it('waits for an assistant message to complete, and skips idle, empty text and unknown shapes', () => {
    const t = { created: 1795596309714 };
    expect(mapEntry({ id: 'm', time: t, type: 'assistant', content: [{ type: 'text', text: 'x' }] }, SESSION)).toEqual(
      [],
    );
    for (const row of [
      { id: 'm', time: t, type: 'idle', outcome: 'succeeded' },
      { id: 'm', time: t, type: 'user', text: '  ', files: [] },
      { id: 'm', time: { ...t, completed: 1 }, type: 'assistant', content: [{ type: 'reasoning', text: 'secret' }] },
      { time: t, type: 'user', text: 'no id' },
      { id: 'm', type: 'other' },
      null,
      'x',
    ]) {
      expect(mapEntry(row, SESSION)).toEqual([]);
    }
  });

  it('maps tool parts of an assistant message to tool rows, after its text; the input is in state.input', () => {
    const row = {
      id: 'msg_9',
      time: { created: 1795596309714, completed: 1795596309999 },
      type: 'assistant',
      content: [
        { type: 'text', text: 'running' },
        { type: 'tool', id: 'c1', name: 'shell', state: { status: 'completed', input: { command: 'echo hi' } } },
        { type: 'tool', id: 'c2', name: 'edit', state: { status: 'completed', input: { path: 'a.ts' } } },
        { type: 'tool', id: 'c3', name: 'read', state: { status: 'running' } },
      ],
    };
    expect(mapEntry(row, SESSION)).toEqual([
      { id: `${SESSION}:msg_9`, at: iso(1795596309714), kind: 'agent', text: 'running' },
      { id: `${SESSION}:msg_9:1`, at: iso(1795596309714), kind: 'tool', tool: 'shell', text: 'echo hi' },
      { id: `${SESSION}:msg_9:2`, at: iso(1795596309714), kind: 'tool', tool: 'edit', text: '{"path":"a.ts"}' },
      { id: `${SESSION}:msg_9:3`, at: iso(1795596309714), kind: 'tool', tool: 'read', text: '' },
    ]);
  });

  it('cuts a long text to 8000 bytes and marks it truncated', async () => {
    const row = JSON.stringify({
      info: {},
      messages: [{ id: 'big', time: { created: 1 }, type: 'user', text: 'é'.repeat(6000), files: [] }],
    });
    sendExport({ id: SESSION, text: row, stateDir, out });
    const last = (await sent()).at(-1)!;
    expect(Buffer.byteLength(last.text)).toBeLessThanOrEqual(8000);
    expect(last.truncated).toBe(true);
  });

  it('reduces the session id and skips an export that is not JSON', async () => {
    sendExport({ id: 'ses/../x y', text: `not json`, stateDir, out });
    expect(existsSync(out)).toBe(false);
    sendExport({ id: 'ses/../x y', text: fixture, stateDir, out });
    expect((await sent())[0]!.id).toBe('ses-..-x-y:msg_002');
  });

  describe('collectExports', () => {
    const sessions = JSON.stringify([{ id: 'ses_a' }, { id: 'ses_b' }]);

    it('gives each CLI call the time left of the budget and stops when it is spent', () => {
      const timeouts: number[] = [];
      const run = (args: string[], timeoutMs: number) => {
        timeouts.push(timeoutMs);
        if (args[1] === 'list') return sessions;
        const end = Date.now() + 80;
        while (Date.now() < end) {
          // Spend the budget.
        }
        return args.at(-1) ?? '';
      };
      expect(collectExports({ run, budgetMs: 50 })).toEqual([{ id: 'ses_a', text: 'ses_a' }]);
      expect(timeouts).toHaveLength(2);
      expect(timeouts.every((t) => t >= 1 && t <= 50)).toBe(true);
    });

    it('reads the real list shape (an array of sessions with ids) and skips an export that fails', () => {
      const run = (args: string[]) => {
        if (args[1] === 'list') return sessions;
        if (args.at(-1) === 'ses_a') throw new Error('gone');
        return 'x';
      };
      expect(collectExports({ run, budgetMs: 5000 })).toEqual([{ id: 'ses_b', text: 'x' }]);
    });
  });

  describe('flush', () => {
    const flush = (extra: Record<string, string> = {}) =>
      spawnSync(process.execPath, [script, 'flush'], {
        encoding: 'utf8',
        env: {
          PATH: `${stubs}:${process.env.PATH}`,
          HOME: home,
          AGENTDESK_STATE_DIR: stateDir,
          AGENTDESK_STATUS_OUT: out,
          STUB_LOG: join(home, 'stub.log'),
          ...extra,
        },
      });

    it('lists the sessions, exports each through the CLI and sends the new rows', async () => {
      await writeFile(join(home, 'stub.log'), '');
      await writeFile(join(home, 'export.json'), fixture);
      const r = flush({
        STUB_OPENCODE_SESSIONS: JSON.stringify([
          { id: SESSION, updated: 2, created: 1, projectId: 'project_001', directory: '/workspace' },
        ]),
        STUB_OPENCODE_EXPORT_FILE: join(home, 'export.json'),
      });
      expect(r.status).toBe(0);
      expect((await sent()).map((e) => e.kind)).toEqual(['user', 'tool', 'agent']);
      const calls = (await readFile(join(home, 'stub.log'), 'utf8'))
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l) as { argv: string[] });
      expect(calls.map((c) => c.argv.slice(0, 3))).toEqual([
        ['session', 'list', '--standalone'],
        ['session', 'export', '--standalone'],
      ]);
      expect(calls[0]!.argv).toEqual(['session', 'list', '--standalone', '--format', 'json']);
      expect(calls[1]!.argv).toContain(SESSION);
    });

    it('skips a session id that is not a plain id (it would reach argv)', async () => {
      await writeFile(join(home, 'stub.log'), '');
      flush({ STUB_OPENCODE_SESSIONS: JSON.stringify([{ id: '--help' }, { id: 'a b' }, { id: 5 }]) });
      const calls = (await readFile(join(home, 'stub.log'), 'utf8')).split('\n').filter(Boolean);
      expect(calls).toHaveLength(1);
    });

    it('prints nothing and exits 0 when the CLI answers with junk or is missing', async () => {
      await writeFile(join(home, 'stub.log'), '');
      expect(flush({ STUB_OPENCODE_SESSIONS: 'junk' }).status).toBe(0);
      const none = spawnSync(process.execPath, [script, 'flush'], {
        encoding: 'utf8',
        env: { PATH: '/nonexistent', HOME: home, AGENTDESK_STATE_DIR: stateDir, AGENTDESK_STATUS_OUT: out },
      });
      expect(none.status).toBe(0);
      expect(existsSync(out)).toBe(false);
    });
  });
});
