import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';

const hook = join(import.meta.dirname, '..', 'agents', 'claude', 'hook.mjs');
const fixtureDir = join(import.meta.dirname, 'fixtures', 'claude-hooks');
const BLOCK_REASON =
  'Before ending your turn, run `agentdesk-status done "<summary>"` if the task is complete, or `agentdesk-status needs_input "<the question>"` if you need an answer from the human. Then end your turn.';

const fixture = async (name: string): Promise<Record<string, unknown>> =>
  JSON.parse(await readFile(join(fixtureDir, `${name}.json`), 'utf8')) as Record<string, unknown>;

let root: string;
let stateDir: string;
let out: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'claude-hook-'));
  stateDir = join(root, 'state');
  out = join(root, 'out.log');
});

const feed = (input: string) =>
  spawnSync(process.execPath, [hook], {
    input,
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH,
      HOME: root,
      AGENTDESK_STATE_DIR: stateDir,
      AGENTDESK_STATUS_OUT: out,
      AGENTDESK_RUN_DIR: join(root, 'run'),
    },
  });

const send = async (name: string, patch: Record<string, unknown> = {}) =>
  feed(JSON.stringify({ ...(await fixture(name)), ...patch }));

// Mirrors what `agentdesk-status` writes, without depending on it.
const declare = async (state: string, summary: string) => {
  await mkdir(stateDir, { recursive: true });
  const file = join(stateDir, 'state.json');
  const prev = existsSync(file) ? (JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>) : {};
  await writeFile(file, JSON.stringify({ ...prev, declared: { state, summary } }));
};

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');

const lines = async () => (existsSync(out) ? (await readFile(out, 'utf8')).split('\n').filter(Boolean) : []);

describe('spike scenarios (spec section 3)', () => {
  it('background shell: waiting background', async () => {
    const r = await send('stop-background-shell');
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('');
    expect(await lines()).toEqual(['agentdesk: state waiting background']);
  });

  it('background subagent: waiting background', async () => {
    await send('stop-background-subagent');
    expect(await lines()).toEqual(['agentdesk: state waiting background']);
  });

  it('wake-up task notification: working', async () => {
    await send('user-prompt-task-notification');
    expect(await lines()).toEqual(['agentdesk: state working']);
  });

  it('AskUserQuestion: needs_input question, then working', async () => {
    await send('pre-ask-user-question');
    await send('post-ask-user-question');
    expect(await lines()).toEqual([
      `agentdesk: state needs_input question ${b64('Which database?')}`,
      'agentdesk: state working',
    ]);
  });

  it('plain question with needs_input declared: needs_input declared', async () => {
    await declare('needs_input', 'Should I use Postgres?');
    await send('stop-plain');
    expect(await lines()).toEqual([`agentdesk: state needs_input declared ${b64('Should I use Postgres?')}`]);
  });

  it('done declared: done declared', async () => {
    await declare('done', 'Fixed it');
    await send('stop-plain');
    expect(await lines()).toEqual([`agentdesk: state done declared ${b64('Fixed it')}`]);
  });
});

describe('claude hook rules', () => {
  it('declared done wins over running background tasks', async () => {
    await declare('done', 'Built');
    const r = await send('stop-background-shell');
    expect(r.stdout).toBe('');
    expect(await lines()).toEqual([`agentdesk: state done declared ${b64('Built')}`]);
  });

  it('undeclared stop blocks once with the exact reason, then falls back to needs_input undeclared', async () => {
    const first = await send('stop-plain');
    expect(JSON.parse(first.stdout)).toEqual({ decision: 'block', reason: BLOCK_REASON });
    expect(await lines()).toEqual([]);
    const second = await send('stop-plain-hook-active');
    expect(second.stdout).toBe('');
    expect(await lines()).toEqual([`agentdesk: state needs_input undeclared ${b64('Should I use Postgres?')}`]);
  });

  it('background finishes after done: working, then done again on the next declared stop', async () => {
    await declare('done', 'Build started');
    await send('stop-background-shell');
    await send('user-prompt-task-notification');
    await declare('done', 'Build finished');
    await send('stop-plain');
    expect(await lines()).toEqual([
      `agentdesk: state done declared ${b64('Build started')}`,
      'agentdesk: state working',
      `agentdesk: state done declared ${b64('Build finished')}`,
    ]);
  });

  it('a declaration lasts one turn: a new prompt clears it', async () => {
    await declare('done', 'Old');
    await send('user-prompt-submit');
    const r = await send('stop-plain');
    expect(JSON.parse(r.stdout).decision).toBe('block');
  });

  it('a tool call after done emits working once; the next tool call emits nothing', async () => {
    await declare('done', 'Done');
    await send('stop-plain');
    await send('pre-tool-bash');
    await send('pre-tool-bash');
    expect(await lines()).toEqual([`agentdesk: state done declared ${b64('Done')}`, 'agentdesk: state working']);
  });

  it('permission_prompt during an open question emits nothing more', async () => {
    await send('pre-ask-user-question');
    await send('notification-permission-prompt');
    expect(await lines()).toEqual([`agentdesk: state needs_input question ${b64('Which database?')}`]);
  });

  it('permission_prompt outside a question emits needs_input approval', async () => {
    await send('user-prompt-submit');
    await send('notification-permission-prompt');
    expect((await lines()).at(-1)).toBe(
      `agentdesk: state needs_input approval ${b64('Claude needs your permission to use Bash')}`,
    );
  });

  it('StopFailure emits needs_input error with an empty note', async () => {
    await send('stop-failure');
    expect(await lines()).toEqual(['agentdesk: state needs_input error -']);
  });

  it('unknown events emit nothing', async () => {
    await send('user-prompt-submit', { hook_event_name: 'SessionStart' });
    expect(await lines()).toEqual([]);
  });

  it('note with newline, 10 kB and $(rm -rf /) is one line, <=1000 chars, base64, and nothing is executed', async () => {
    const marker = join(root, 'pwned');
    const nasty = `line1\nline2 $(touch ${marker}) \`touch ${marker}\` ${'x'.repeat(10_000)}`;
    await declare('needs_input', nasty);
    await send('stop-plain');
    const all = await lines();
    expect(all).toHaveLength(1);
    const m = /^agentdesk: state needs_input declared ([A-Za-z0-9+/=]+)$/.exec(all[0] ?? '');
    expect(m).not.toBeNull();
    const note = Buffer.from(m?.[1] ?? '', 'base64').toString('utf8');
    expect(note).not.toMatch(/[\r\n]/);
    expect(note.length).toBe(1000);
    expect(note.startsWith('line1 line2 $(touch')).toBe(true);
    expect(existsSync(marker)).toBe(false);
  });

  it('a PreToolUse while already working does not rewrite the state file', async () => {
    await send('user-prompt-submit');
    const file = join(stateDir, 'state.json');
    const before = await stat(file);
    for (let i = 0; i < 3; i++) await send('pre-tool-bash');
    const after = await stat(file);
    expect(after.ino).toBe(before.ino);
    expect(after.mtimeMs).toBe(before.mtimeMs);
    expect(await lines()).toEqual(['agentdesk: state working']);
  });

  it('marks the pod as having heard from a hook, which switches the entrypoint startup check off', async () => {
    const seen = join(root, 'run', 'hook-seen');
    expect(existsSync(seen)).toBe(false);
    await send('pre-tool-bash');
    expect(existsSync(seen)).toBe(true);
  });

  it('the first hook in a pod re-emits working even when a saved state from an earlier pod says working', async () => {
    await mkdir(stateDir, { recursive: true });
    await writeFile(join(stateDir, 'state.json'), JSON.stringify({ last: 'working' }));
    await send('pre-tool-bash');
    await send('pre-tool-bash');
    expect(await lines()).toEqual(['agentdesk: state working']);
  });

  it('still works when the run dir cannot be written', async () => {
    await writeFile(join(root, 'run'), 'not a directory');
    const r = await send('pre-tool-bash');
    expect(r.status).toBe(0);
    expect(await lines()).toEqual(['agentdesk: state working']);
  });

  it('invalid JSON on stdin emits nothing and exits 0', async () => {
    const r = feed('{nope');
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('');
    expect(await lines()).toEqual([]);
  });
});

describe('claude hook transcript step', () => {
  it('every handled event also sends new transcript entries', async () => {
    const transcript = join(root, 't.jsonl');
    await writeFile(
      transcript,
      `${JSON.stringify({ type: 'user', uuid: 'u1', message: { content: 'fix the bug' } })}\n`,
    );
    const r = await send('user-prompt-submit', { transcript_path: transcript });
    expect(r.status).toBe(0);
    const all = await lines();
    expect(all[0]).toBe('agentdesk: state working');
    expect(all).toHaveLength(2);
    expect(all[1]?.startsWith('agentdesk: transcript ')).toBe(true);
    const entry = JSON.parse(
      Buffer.from((all[1] ?? '').replace('agentdesk: transcript ', ''), 'base64').toString('utf8'),
    );
    expect(entry).toMatchObject({ id: 'u1:0', kind: 'user', text: 'fix the bug' });
  });

  it('a throwing transcript step leaves the status line and exit code unchanged', async () => {
    const dir = join(root, 'a-directory');
    await mkdir(dir);
    const r = await send('user-prompt-submit', { transcript_path: dir });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('');
    expect(await lines()).toEqual(['agentdesk: state working']);
  });
});
