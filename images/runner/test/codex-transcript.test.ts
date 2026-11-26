import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { appendFile, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { mapEntry, sendNew, transcriptStep } from '../agents/codex/transcript.mjs';

const script = join(import.meta.dirname, '..', 'agents', 'codex', 'transcript.mjs');
const fixture = join(import.meta.dirname, 'fixtures', 'codex-transcript', 'session.jsonl');
const SESSION = '00000000-0000-7000-8000-000000000001';
const FILE = `rollout-2026-11-25T08-15-54-${SESSION}.jsonl`;

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
let session: string;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'codex-transcript-'));
  stateDir = join(home, '.agentdesk');
  out = join(home, 'out.log');
  const dir = join(home, '.codex', 'sessions', '2026', '11', '25');
  await mkdir(dir, { recursive: true });
  session = join(dir, FILE);
  await writeFile(session, await readFile(fixture, 'utf8'));
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

const row = (ordinal: number, type: string, payload: Record<string, unknown>) =>
  `${JSON.stringify({ timestamp: '2026-01-01T00:00:09.000Z', ordinal, type, payload })}\n`;

describe('codex transcript adapter', () => {
  it('turns the recorded session into one user row and one assistant row (no duplicates from response_item)', async () => {
    sendNew({ paths: [session], stateDir, out });
    expect(await sent()).toEqual([
      { id: `${SESSION}:5`, at: '2026-01-01T00:00:05.000Z', kind: 'user', text: 'say hi' },
      { id: `${SESSION}:6`, at: '2026-01-01T00:00:06.000Z', kind: 'agent', text: 'Hello from mock' },
    ]);
  });

  it('maps tool calls to tool rows (shell command, function call, other tools)', () => {
    const p = `${SESSION}`;
    expect(
      mapEntry(
        JSON.parse(
          row(10, 'response_item', { type: 'local_shell_call', action: { command: ['bash', '-lc', 'ls -la'] } }),
        ),
        p,
      ),
    ).toEqual([
      { id: `${p}:10`, at: '2026-01-01T00:00:09.000Z', kind: 'tool', tool: 'shell', text: 'bash -lc ls -la' },
    ]);
    expect(
      mapEntry(
        JSON.parse(row(11, 'response_item', { type: 'function_call', name: 'shell', arguments: '{"command":["ls"]}' })),
        p,
      ),
    ).toEqual([{ id: `${p}:11`, at: '2026-01-01T00:00:09.000Z', kind: 'tool', tool: 'shell', text: 'ls' }]);
    expect(
      mapEntry(
        JSON.parse(row(12, 'response_item', { type: 'function_call', name: 'apply_patch', arguments: '{"a":1}' })),
        p,
      ),
    ).toEqual([{ id: `${p}:12`, at: '2026-01-01T00:00:09.000Z', kind: 'tool', tool: 'apply_patch', text: '{"a":1}' }]);
  });

  it('skips meta, reasoning, developer messages and unknown shapes', () => {
    const p = SESSION;
    for (const [type, payload] of [
      ['session_meta', { id: 'x' }],
      ['turn_context', {}],
      ['response_item', { type: 'reasoning', summary: [] }],
      [
        'response_item',
        { type: 'message', role: 'developer', content: [{ type: 'input_text', text: 'secret rules' }] },
      ],
      ['event_msg', { type: 'token_count' }],
      [
        'event_msg',
        { type: 'item_completed', item: { type: 'AgentMessage', content: [{ type: 'Text', text: '  ' }] } },
      ],
    ] as const) {
      expect(mapEntry(JSON.parse(row(3, type, payload)), p)).toEqual([]);
    }
    expect(mapEntry(null, p)).toEqual([]);
    expect(mapEntry({ type: 'event_msg', payload: {} }, p)).toEqual([]);
  });

  it('sends only new complete lines on the next call and never resends', async () => {
    sendNew({ paths: [session], stateDir, out });
    sendNew({ paths: [session], stateDir, out });
    expect(await sent()).toHaveLength(2);
    await appendFile(
      session,
      row(20, 'event_msg', {
        type: 'item_completed',
        item: { type: 'AgentMessage', content: [{ type: 'Text', text: 'More' }] },
      }),
    );
    await appendFile(session, '{"partial":');
    sendNew({ paths: [session], stateDir, out });
    expect((await sent()).map((e) => e.text)).toEqual(['say hi', 'Hello from mock', 'More']);
  });

  it('cuts a long text to 8000 bytes and marks it truncated', async () => {
    await appendFile(
      session,
      row(30, 'event_msg', {
        type: 'item_completed',
        item: { type: 'AgentMessage', content: [{ type: 'Text', text: 'é'.repeat(6000) }] },
      }),
    );
    sendNew({ paths: [session], stateDir, out });
    const last = (await sent()).at(-1)!;
    expect(Buffer.byteLength(last.text)).toBeLessThanOrEqual(8000);
    expect(last.truncated).toBe(true);
  });

  it('transcriptStep takes the path from a hook input under HOME and ignores one outside', async () => {
    const env = { HOME: home, AGENTDESK_STATE_DIR: stateDir, AGENTDESK_STATUS_OUT: out };
    transcriptStep({ transcript_path: '/etc/passwd' }, env);
    transcriptStep({ nothing: true }, env);
    expect(await sent()).toEqual([]);
    transcriptStep({ transcript_path: session }, env);
    expect(await sent()).toHaveLength(2);
  });

  it('flush sends the newest session file under CODEX_HOME and exits 0', async () => {
    const r = spawnSync(process.execPath, [script, 'flush'], {
      encoding: 'utf8',
      env: { PATH: process.env.PATH, HOME: home, AGENTDESK_STATE_DIR: stateDir, AGENTDESK_STATUS_OUT: out },
    });
    expect(r.status).toBe(0);
    expect((await sent()).map((e) => e.kind)).toEqual(['user', 'agent']);
  });

  it('flush honours CODEX_HOME', async () => {
    const other = join(home, 'elsewhere');
    await mkdir(join(other, 'sessions', '2026'), { recursive: true });
    await writeFile(
      join(other, 'sessions', '2026', FILE),
      row(1, 'event_msg', {
        type: 'item_completed',
        item: { type: 'UserMessage', content: [{ type: 'text', text: 'from other home' }] },
      }),
    );
    spawnSync(process.execPath, [script, 'flush'], {
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH,
        HOME: home,
        CODEX_HOME: other,
        AGENTDESK_STATE_DIR: stateDir,
        AGENTDESK_STATUS_OUT: out,
      },
    });
    expect((await sent()).map((e) => e.text)).toEqual(['from other home']);
  });

  it('flush with no session file prints nothing and exits 0', async () => {
    const empty = await mkdtemp(join(tmpdir(), 'codex-empty-'));
    const r = spawnSync(process.execPath, [script, 'flush'], {
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH,
        HOME: empty,
        AGENTDESK_STATE_DIR: join(empty, 's'),
        AGENTDESK_STATUS_OUT: join(empty, 'o'),
      },
    });
    expect(r.status).toBe(0);
    expect(existsSync(join(empty, 'o'))).toBe(false);
  });
});
