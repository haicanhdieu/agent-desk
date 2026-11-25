import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';

const hook = join(import.meta.dirname, '..', 'agents', 'codex', 'hook.mjs');
const fixtureFile = join(import.meta.dirname, 'fixtures', 'codex-hooks', 'events.jsonl');
const BLOCK_REASON =
  'Before ending your turn, run `agentdesk-status done "<summary>"` if the task is complete, or `agentdesk-status needs_input "<the question>"` if you need an answer from the human. Then end your turn.';

type Event = Record<string, unknown>;

/** The recorded events of the spike, by hook_event_name. */
const recorded = async (): Promise<Record<string, Event>> => {
  const byName: Record<string, Event> = {};
  for (const line of (await readFile(fixtureFile, 'utf8')).split('\n').filter(Boolean)) {
    const e = JSON.parse(line) as Event;
    byName[String(e.hook_event_name)] = e;
  }
  return byName;
};

let root: string;
let stateDir: string;
let out: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'codex-hook-'));
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

const send = async (name: string, patch: Event = {}) => feed(JSON.stringify({ ...(await recorded())[name], ...patch }));

// Mirrors what `agentdesk-status` writes, without depending on it.
const declare = async (state: string, summary: string) => {
  await mkdir(stateDir, { recursive: true });
  const file = join(stateDir, 'state.json');
  const prev = existsSync(file) ? (JSON.parse(await readFile(file, 'utf8')) as Event) : {};
  await writeFile(file, JSON.stringify({ ...prev, declared: { state, summary } }));
};

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');
const lines = async () => (existsSync(out) ? (await readFile(out, 'utf8')).split('\n').filter(Boolean) : []);

describe('codex hook: recorded spike events map to the Claude hook statuses', () => {
  it('SessionStart and SessionEnd print nothing', async () => {
    expect((await send('SessionStart')).status).toBe(0);
    expect((await send('SessionEnd')).status).toBe(0);
    expect(await lines()).toEqual([]);
  });

  it('UserPromptSubmit is working', async () => {
    const r = await send('UserPromptSubmit');
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('');
    expect(await lines()).toEqual(['agentdesk: state working']);
  });

  it('a declared done at Stop is done declared, and is consumed', async () => {
    await send('UserPromptSubmit');
    await declare('done', 'All finished');
    const r = await send('Stop');
    expect(r.stdout).toBe('');
    expect(await lines()).toEqual([
      'agentdesk: state working',
      `agentdesk: state done declared ${b64('All finished')}`,
    ]);
    // The declaration is used up: the next Stop blocks again.
    expect((await send('Stop')).stdout).toContain('"decision":"block"');
  });

  it('a declared needs_input at Stop is needs_input declared', async () => {
    await declare('needs_input', 'Which branch?');
    await send('Stop');
    expect(await lines()).toEqual([`agentdesk: state needs_input declared ${b64('Which branch?')}`]);
  });

  it('Stop with nothing declared blocks once with the declare-first reason and prints no status', async () => {
    const r = await send('Stop');
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual({ decision: 'block', reason: BLOCK_REASON });
    expect(await lines()).toEqual([]);
  });

  it('Stop again with nothing declared (stop_hook_active) is needs_input undeclared with the last message', async () => {
    const r = await send('Stop', { stop_hook_active: true });
    expect(r.stdout).toBe('');
    expect(await lines()).toEqual([`agentdesk: state needs_input undeclared ${b64('Hello from mock')}`]);
  });

  it('PermissionRequest is needs_input approval, once', async () => {
    await send('UserPromptSubmit');
    const request = { hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { description: 'Run npm' } };
    await send('UserPromptSubmit', request);
    await send('UserPromptSubmit', request);
    expect(await lines()).toEqual([
      'agentdesk: state working',
      `agentdesk: state needs_input approval ${b64('Run npm')}`,
    ]);
  });

  it('a tool call after an approval request is working again, and repeated tool calls print working once', async () => {
    const tool = { hook_event_name: 'PreToolUse', tool_name: 'Bash' };
    await send('UserPromptSubmit', { hook_event_name: 'PermissionRequest', tool_input: { command: 'ls' } });
    await send('UserPromptSubmit', { hook_event_name: 'PostToolUse', tool_name: 'Bash' });
    await send('UserPromptSubmit', tool);
    await send('UserPromptSubmit', tool);
    expect(await lines()).toEqual([`agentdesk: state needs_input approval ${b64('ls')}`, 'agentdesk: state working']);
  });

  it('creates hook-seen on the first hook of any kind', async () => {
    await send('SessionStart');
    expect(existsSync(join(root, 'run', 'hook-seen'))).toBe(true);
  });

  it('ignores input that is not a JSON object', async () => {
    expect(feed('not json').status).toBe(0);
    expect(feed('[1]').status).toBe(0);
    expect(await lines()).toEqual([]);
  });

  it('note text is one line, control characters removed, capped', async () => {
    await send('Stop', { stop_hook_active: true, last_assistant_message: `a\nb${'x'.repeat(2000)}` });
    const [line] = await lines();
    const note = Buffer.from(line!.split(' ').at(-1)!, 'base64').toString('utf8');
    expect(note.startsWith('a b')).toBe(true);
    expect(note.length).toBe(1000);
  });
});
