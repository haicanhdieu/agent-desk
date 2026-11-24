import { appendFile, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { mapUsage, sendNew, transcriptStep, usageLine } from '../agents/claude/transcript.mjs';

// Fixtures: images/runner/test/fixtures/claude-usage/README.md says which rows are real (scrubbed, Claude Code
// 2.1.323) and which are derived by editing a real row.
const fixtures = join(import.meta.dirname, 'fixtures', 'claude-usage');
const PREFIX = 'agentdesk: usage ';

interface Wire {
  id: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  cacheWriteLongTokens: number;
}

let home: string;
let stateDir: string;
let out: string;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'claude-usage-'));
  stateDir = join(home, '.agentdesk');
  out = join(home, 'out.log');
});

const decode = (line: string): Wire =>
  JSON.parse(Buffer.from(line.slice(PREFIX.length), 'base64').toString('utf8')) as Wire;

const usageSent = async (): Promise<Wire[]> =>
  existsSync(out)
    ? (await readFile(out, 'utf8'))
        .split('\n')
        .filter((l) => l.startsWith(PREFIX))
        .map(decode)
    : [];

const copyFixture = async (name: string, to = join(home, name)) => {
  await writeFile(to, await readFile(join(fixtures, name), 'utf8'));
  return to;
};

const row = (over: {
  id?: string;
  requestId?: string | null;
  model?: string;
  output?: number;
  usage?: Record<string, unknown> | null;
  sidechain?: boolean;
}) => {
  const usage =
    over.usage === null
      ? undefined
      : (over.usage ?? {
          input_tokens: 10,
          output_tokens: over.output ?? 5,
          cache_read_input_tokens: 3,
          cache_creation_input_tokens: 7,
          cache_creation: { ephemeral_5m_input_tokens: 4, ephemeral_1h_input_tokens: 3 },
        });
  return {
    type: 'assistant',
    isSidechain: over.sidechain ?? false,
    uuid: `u-${Math.random()}`,
    ...(over.requestId === null ? {} : { requestId: over.requestId ?? 'req_01' }),
    message: {
      id: over.id ?? 'msg_01',
      model: over.model ?? 'claude-sonnet-5-5',
      content: [],
      ...(usage ? { usage } : {}),
    },
  };
};
const jsonl = (...rows: unknown[]) => `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`;

describe('mapUsage', () => {
  it('maps the id as message:request, or the message id alone', () => {
    expect(mapUsage(row({ id: 'msg_01', requestId: 'req_01' }))?.id).toBe('msg_01:req_01');
    expect(mapUsage(row({ id: 'msg_01', requestId: null }))?.id).toBe('msg_01');
  });

  it('maps the cache split to standard and long cache writes', () => {
    expect(mapUsage(row({}))).toEqual({
      id: 'msg_01:req_01',
      model: 'claude-sonnet-5-5',
      inputTokens: 10,
      outputTokens: 5,
      cacheReadTokens: 3,
      cacheWriteTokens: 4,
      cacheWriteLongTokens: 3,
    });
  });

  it('counts the whole cache creation as standard when the split is missing', () => {
    const u = mapUsage(
      row({ usage: { input_tokens: 1, output_tokens: 2, cache_read_input_tokens: 0, cache_creation_input_tokens: 9 } }),
    );
    expect(u).toMatchObject({ cacheWriteTokens: 9, cacheWriteLongTokens: 0 });
  });

  it('defaults missing cache counters to 0', () => {
    expect(mapUsage(row({ usage: { input_tokens: 1, output_tokens: 2 } }))).toMatchObject({
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      cacheWriteLongTokens: 0,
    });
  });

  it('counts a sidechain entry', () => {
    expect(mapUsage(row({ sidechain: true }))).toBeDefined();
  });

  it('ignores synthetic models, entries without usage, non-assistant rows and bad counts', () => {
    expect(mapUsage(row({ model: '<synthetic>' }))).toBeUndefined();
    expect(mapUsage(row({ usage: null }))).toBeUndefined();
    expect(mapUsage({ ...row({}), type: 'user' })).toBeUndefined();
    expect(mapUsage(row({ usage: { input_tokens: 'x', output_tokens: 1 } }))).toBeUndefined();
    expect(mapUsage(row({ usage: { input_tokens: -1, output_tokens: 1 } }))).toBeUndefined();
    expect(mapUsage(null)).toBeUndefined();
    expect(
      mapUsage({ type: 'assistant', message: { model: 'm', usage: { input_tokens: 1, output_tokens: 1 } } }),
    ).toBeUndefined();
  });
});

describe('usageLine', () => {
  it('prints exactly the wire keys', () => {
    const u = mapUsage(row({}));
    if (!u) throw new Error('no usage');
    const line = usageLine(u);
    expect(line?.startsWith(PREFIX)).toBe(true);
    expect(Object.keys(decode(line as string)).sort()).toEqual(
      [
        'cacheReadTokens',
        'cacheWriteLongTokens',
        'cacheWriteTokens',
        'id',
        'inputTokens',
        'model',
        'outputTokens',
      ].sort(),
    );
  });

  it('prints nothing for a body over 1000 chars', () => {
    expect(
      usageLine({
        id: 'x'.repeat(900),
        model: 'm',
        inputTokens: 1,
        outputTokens: 1,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        cacheWriteLongTokens: 0,
      }),
    ).toBeUndefined();
  });
});

describe('sendNew usage lines', () => {
  it('prints one line per id per pass, with the final count, for the streaming fixture', async () => {
    const path = await copyFixture('streaming-rows.jsonl');
    sendNew({ paths: [path], stateDir, out });
    const sent = await usageSent();
    expect(sent.map((s) => [s.id, s.outputTokens])).toEqual([
      ['msg_01:req_02', 364],
      ['msg_03:req_04', 90],
    ]);
  });

  it('prints the larger count once when the rows arrive in the reverse order', async () => {
    const path = join(home, 's.jsonl');
    await writeFile(path, jsonl(row({ output: 500 }), row({ output: 1 })));
    sendNew({ paths: [path], stateDir, out });
    expect((await usageSent()).map((s) => s.outputTokens)).toEqual([500]);
  });

  it('prints the final row again when a later pass sees it', async () => {
    const path = join(home, 's.jsonl');
    await writeFile(path, jsonl(row({ output: 1 })));
    sendNew({ paths: [path], stateDir, out });
    await appendFile(path, jsonl(row({ output: 500 })));
    sendNew({ paths: [path], stateDir, out });
    expect((await usageSent()).map((s) => s.outputTokens)).toEqual([1, 500]);
  });

  it('keeps a retry (new id) and two models as separate calls', async () => {
    const path = await copyFixture('retry-two-models.jsonl');
    sendNew({ paths: [path], stateDir, out });
    const sent = await usageSent();
    expect(sent.map((s) => s.id)).toEqual(['msg_first:req_first', 'msg_retry:req_retry', 'msg_other:req_other']);
    expect(new Set(sent.map((s) => s.model))).toEqual(new Set(['claude-sonnet-5-5', 'claude-haiku-4-5']));
  });

  it('handles sidechain rows, synthetic rows, rows without usage or request id, and a missing split', async () => {
    const path = await copyFixture('sidechain-and-edge.jsonl');
    sendNew({ paths: [path], stateDir, out });
    const sent = await usageSent();
    expect(sent.map((s) => s.id)).toEqual([
      'msg_05:req_06',
      'msg_07:req_08',
      'msg_norequest',
      'msg_nosplit:req_nosplit',
    ]);
    expect(sent[3]).toMatchObject({ cacheWriteTokens: 1311, cacheWriteLongTokens: 0 });
  });

  it('prints no transcript text in a usage line', async () => {
    const path = await copyFixture('sidechain-and-edge.jsonl');
    sendNew({ paths: [path], stateDir, out });
    for (const l of (await readFile(out, 'utf8')).split('\n').filter((l) => l.startsWith(PREFIX))) {
      expect(Buffer.from(l.slice(PREFIX.length), 'base64').toString('utf8')).not.toMatch(/scrubbed|price|cost/i);
    }
  });

  it('writes state version 2, and re-reads a state file without a version from 0 once', async () => {
    const path = join(home, 's.jsonl');
    await writeFile(path, jsonl(row({ output: 9 })));
    mkdirSync(stateDir, { recursive: true });
    await writeFile(join(stateDir, 'transcript.json'), JSON.stringify({ files: { [path]: { offset: 100000 } } }));
    sendNew({ paths: [path], stateDir, out });
    expect(await usageSent()).toHaveLength(1);
    expect(JSON.parse(await readFile(join(stateDir, 'transcript.json'), 'utf8'))).toMatchObject({ version: 2 });
    sendNew({ paths: [path], stateDir, out });
    expect(await usageSent()).toHaveLength(1);
  });

  it('keeps usage whose append failed and prints it on the next pass, without repeating transcript lines', async () => {
    const path = join(home, 's.jsonl');
    await writeFile(path, jsonl(row({ id: 'msg_lost', output: 77 })));
    mkdirSync(out); // an unwritable output: the append fails
    sendNew({ paths: [path], stateDir, out });
    rmSync(out, { recursive: true });
    await appendFile(path, jsonl(row({ id: 'msg_next', output: 5 })));
    sendNew({ paths: [path], stateDir, out });
    expect((await usageSent()).map((s) => [s.id, s.outputTokens])).toEqual([
      ['msg_lost:req_01', 77],
      ['msg_next:req_01', 5],
    ]);
    sendNew({ paths: [path], stateDir, out });
    expect(await usageSent()).toHaveLength(2);
  });

  it('also reads the session subagent files (Claude Code 2.1.323 writes sidechain calls there)', async () => {
    const path = join(home, 'sess.jsonl');
    await writeFile(path, jsonl(row({ id: 'msg_main' })));
    const sub = join(home, 'sess', 'subagents');
    mkdirSync(sub, { recursive: true });
    await writeFile(join(sub, 'agent-a1.jsonl'), jsonl(row({ id: 'msg_sub', sidechain: true })));
    await writeFile(join(sub, 'agent-a1.meta.json'), '{}');
    sendNew({ paths: [path], stateDir, out });
    expect((await usageSent()).map((s) => s.id).sort()).toEqual(['msg_main:req_01', 'msg_sub:req_01']);
  });

  it('prints no transcript line for a subagent file, but still prints their usage', async () => {
    const path = join(home, 'sess.jsonl');
    const text = (t: string) => [{ type: 'text', text: t }];
    const main = {
      ...row({ id: 'msg_main' }),
      message: { ...row({ id: 'msg_main' }).message, content: text('main reply') },
    };
    await writeFile(path, jsonl(main));
    const sub = join(home, 'sess', 'subagents');
    mkdirSync(sub, { recursive: true });
    const subUser = {
      type: 'user',
      isSidechain: true,
      uuid: 'u-sub-user',
      message: { role: 'user', content: 'subagent prompt' },
    };
    const subAssistant = {
      ...row({ id: 'msg_sub', sidechain: true }),
      message: { ...row({ id: 'msg_sub' }).message, content: text('subagent reply') },
    };
    await writeFile(join(sub, 'agent-a1.jsonl'), jsonl(subUser, subAssistant));
    sendNew({ paths: [path], stateDir, out });
    const printed = (await readFile(out, 'utf8'))
      .split('\n')
      .filter((l) => l.startsWith('agentdesk: transcript '))
      .map((l) => Buffer.from(l.slice('agentdesk: transcript '.length), 'base64').toString('utf8'));
    expect(printed).toHaveLength(1);
    expect(printed[0]).toContain('main reply');
    expect((await usageSent()).map((s) => s.id).sort()).toEqual(['msg_main:req_01', 'msg_sub:req_01']);
  });

  it('still prints the transcript line of a main-file row marked isSidechain', async () => {
    const path = await copyFixture('sidechain-and-edge.jsonl');
    sendNew({ paths: [path], stateDir, out });
    const printed = (await readFile(out, 'utf8')).split('\n').filter((l) => l.startsWith('agentdesk: transcript '));
    expect(printed.length).toBeGreaterThanOrEqual(2);
    const first = Buffer.from(printed[0]!.slice('agentdesk: transcript '.length), 'base64').toString('utf8');
    expect(first).toContain('00000000-0000-4000-8000-000000000009');
  });

  it('transcriptStep sends the subagent files of the hook transcript path', async () => {
    const path = join(home, 'sess.jsonl');
    await writeFile(path, jsonl(row({ id: 'msg_main' })));
    const sub = join(home, 'sess', 'subagents');
    mkdirSync(sub, { recursive: true });
    await writeFile(join(sub, 'agent-a1.jsonl'), jsonl(row({ id: 'msg_sub', sidechain: true })));
    transcriptStep({ transcript_path: path }, { HOME: home, AGENTDESK_STATE_DIR: stateDir, AGENTDESK_STATUS_OUT: out });
    expect(await usageSent()).toHaveLength(2);
  });
});
