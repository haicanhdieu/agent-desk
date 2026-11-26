import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import plugin, { consume } from '../agents/opencode/hook.mjs';

const fixtureFile = join(import.meta.dirname, 'fixtures', 'opencode-hooks', 'events.jsonl');

type Event = { type: string; data: Record<string, unknown> };
const recorded = async (): Promise<Event[]> =>
  (await readFile(fixtureFile, 'utf8'))
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Event);

let root: string;
let env: Record<string, string>;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'opencode-hook-'));
  env = {
    AGENTDESK_STATE_DIR: join(root, 'state'),
    AGENTDESK_STATUS_OUT: join(root, 'out.log'),
    AGENTDESK_RUN_DIR: join(root, 'run'),
    // No transcript flush in the status tests.
    AGENTDESK_LIB_DIR: join(root, 'no-lib'),
  };
});

async function* feed(events: Event[]): AsyncGenerator<Event> {
  for (const e of events) yield e;
}
const run = (events: Event[]) => consume(feed(events), env) as Promise<void>;
const lines = async () =>
  existsSync(env.AGENTDESK_STATUS_OUT!)
    ? (await readFile(env.AGENTDESK_STATUS_OUT!, 'utf8')).split('\n').filter(Boolean)
    : [];
const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');
const ev = (type: string, data: Record<string, unknown> = {}): Event => ({
  type,
  data: { sessionID: 'ses_1', ...data },
});
const declare = async (state: string, summary: string) => {
  await mkdir(env.AGENTDESK_STATE_DIR!, { recursive: true });
  await writeFile(join(env.AGENTDESK_STATE_DIR!, 'state.json'), JSON.stringify({ declared: { state, summary } }));
};

describe('opencode status plugin: recorded spike events map to the Claude hook statuses', () => {
  it('has the default-export shape OpenCode loads', () => {
    expect(typeof plugin.id).toBe('string');
    expect(plugin.id).not.toBe('');
    expect(typeof plugin.setup).toBe('function');
  });

  it('maps the two recorded sessions: working, undeclared stop, working, approval, working, undeclared stop', async () => {
    await run(await recorded());
    expect(await lines()).toEqual([
      'agentdesk: state working',
      `agentdesk: state needs_input undeclared ${b64('pong')}`,
      'agentdesk: state working',
      `agentdesk: state needs_input approval ${b64('echo hi')}`,
      'agentdesk: state working',
      `agentdesk: state needs_input undeclared ${b64('done')}`,
    ]);
  });

  it('creates hook-seen at plugin start, before any event', async () => {
    await run([]);
    expect(existsSync(join(env.AGENTDESK_RUN_DIR!, 'hook-seen'))).toBe(true);
    expect(await lines()).toEqual([]);
  });

  it('a declared done at the end of the execution is done declared, and is consumed', async () => {
    await run([ev('session.execution.started')]);
    await declare('done', 'All finished');
    await run([ev('session.execution.succeeded')]);
    expect(await lines()).toEqual([
      'agentdesk: state working',
      `agentdesk: state done declared ${b64('All finished')}`,
    ]);
    await run([ev('session.execution.succeeded')]);
    expect((await lines()).at(-1)).toBe('agentdesk: state needs_input undeclared -');
  });

  it('a declared needs_input is needs_input declared', async () => {
    await declare('needs_input', 'Which branch?');
    await run([ev('session.execution.succeeded')]);
    expect(await lines()).toEqual([`agentdesk: state needs_input declared ${b64('Which branch?')}`]);
  });

  it('a new execution drops an old declaration', async () => {
    await declare('done', 'stale');
    await run([ev('session.execution.started'), ev('session.execution.succeeded')]);
    expect((await lines()).at(-1)).toBe('agentdesk: state needs_input undeclared -');
  });

  it.each(['session.execution.failed', 'session.execution.interrupted'])(
    '%s ends the turn like a stop',
    async (type) => {
      await run([ev('session.execution.started'), ev('session.text.ended', { text: 'half way' }), ev(type)]);
      expect(await lines()).toEqual([
        'agentdesk: state working',
        `agentdesk: state needs_input undeclared ${b64('half way')}`,
      ]);
    },
  );

  it('an approval is reported once, and any reply (once, always, reject) is working again', async () => {
    const ask = ev('permission.asked', { id: 'per_1', action: 'shell', resources: ['npm test'] });
    await run([
      ask,
      ask,
      ev('permission.replied', { requestID: 'per_1', reply: 'reject' }),
      ev('permission.replied', { reply: 'once' }),
    ]);
    expect(await lines()).toEqual([
      `agentdesk: state needs_input approval ${b64('npm test')}`,
      'agentdesk: state working',
    ]);
  });

  it('an approval with no resources falls back to the action name', async () => {
    await run([ev('permission.asked', { action: 'edit' })]);
    expect(await lines()).toEqual([`agentdesk: state needs_input approval ${b64('edit')}`]);
  });

  it('a login or model prompt (no session event) and shutdown print nothing', async () => {
    await run([{ type: 'location.shutdown', data: {} }, ev('session.step.started'), ev('session.usage.updated')]);
    expect(await lines()).toEqual([]);
  });

  it('events that are not objects with a string type are ignored', async () => {
    await consume(feed([null, 'x', { type: 5 }, { data: {} }] as unknown as Event[]), env);
    expect(await lines()).toEqual([]);
  });

  it('note text is one line, control characters removed, capped at 1000', async () => {
    await run([ev('session.text.ended', { text: `a\nb${'x'.repeat(2000)}` }), ev('session.execution.succeeded')]);
    const [line] = await lines();
    const note = Buffer.from(line!.split(' ').at(-1)!, 'base64').toString('utf8');
    expect(note.startsWith('a b')).toBe(true);
    expect(note.length).toBe(1000);
  });

  it('asks the transcript adapter to flush when a turn ends', async () => {
    const lib = join(root, 'lib');
    await mkdir(join(lib, 'agents', 'opencode'), { recursive: true });
    await writeFile(
      join(lib, 'agents', 'opencode', 'transcript.mjs'),
      "import { writeFileSync } from 'node:fs'; writeFileSync(process.env.MARKER, process.argv[2]);",
    );
    env = { ...env, AGENTDESK_LIB_DIR: lib, MARKER: join(root, 'flushed') };
    await run([ev('session.execution.started'), ev('session.execution.succeeded')]);
    await expect.poll(() => existsSync(join(root, 'flushed'))).toBe(true);
    expect(await readFile(join(root, 'flushed'), 'utf8')).toBe('flush');
  });

  it('setup subscribes to the event stream without awaiting it', async () => {
    const saved = { ...process.env };
    Object.assign(process.env, env);
    try {
      let subscribed = 0;
      const ctx = {
        event: {
          subscribe: () => {
            subscribed += 1;
            return feed([ev('session.execution.started')]);
          },
        },
      };
      await plugin.setup(ctx);
      expect(subscribed).toBe(1);
      await expect.poll(lines).toEqual(['agentdesk: state working']);
    } finally {
      for (const k of Object.keys(env)) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
      }
    }
  });
});
