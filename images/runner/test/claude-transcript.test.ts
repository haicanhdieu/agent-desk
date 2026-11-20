import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { appendFile, mkdir, mkdtemp, readFile, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { fitText, mapEntry, sendNew, transcriptStep, wireLine } from '../agents/claude/transcript.mjs';

const script = join(import.meta.dirname, '..', 'agents', 'claude', 'transcript.mjs');
const fixtures = join(import.meta.dirname, 'fixtures', 'claude-transcript');

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

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'claude-transcript-'));
  stateDir = join(home, '.agentdesk');
  out = join(home, 'out.log');
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

const copyFixture = async (name: string, to = join(home, `${name}`)) => {
  await writeFile(to, await readFile(join(fixtures, name), 'utf8'));
  return to;
};

const at = (n: number) => `2026-11-19T10:00:${String(n).padStart(2, '0')}.000Z`;

describe('claude transcript adapter', () => {
  it('maps the fixture session to the expected wire entries', async () => {
    const path = await copyFixture('session.jsonl');
    sendNew({ paths: [path], stateDir, out });
    expect(await sent()).toEqual([
      { id: 'u1:0', at: at(1), kind: 'user', text: 'Fix the failing tests' },
      { id: 'a3:1', at: at(3), kind: 'agent', text: 'I will run the tests.' },
      { id: 'a3:2', at: at(3), kind: 'tool', tool: 'Bash', text: 'dotnet test' },
      { id: 'a5:0', at: at(5), kind: 'tool', tool: 'Edit', text: 'src/a.ts' },
      { id: 'a5:1', at: at(5), kind: 'tool', tool: 'Write', text: 'src/b.ts' },
      { id: 'a5:2', at: at(5), kind: 'tool', tool: 'Read', text: 'src/c.ts' },
      { id: 'a5:3', at: at(5), kind: 'tool', tool: 'Grep', text: '{"pattern":"foo"}' },
      { id: 'u6:0', at: at(6), kind: 'user', text: 'Also update the docs' },
      { id: 's7:0', at: at(7), kind: 'notice', text: 'Conversation compacted' },
      { id: 'a9:0', at: at(9), kind: 'notice', text: 'API Error: 401 invalid credential' },
      { id: 'a11:0', at: at(11), kind: 'agent', text: 'Done.' },
    ]);
  });

  it('skips thinking, tool results, meta, summary and unknown shapes', async () => {
    const path = await copyFixture('session.jsonl');
    sendNew({ paths: [path], stateDir, out });
    const text = await readFile(out, 'utf8');
    const all = text
      .split('\n')
      .filter(Boolean)
      .map((l) => Buffer.from(l.replace('agentdesk: transcript ', ''), 'base64').toString('utf8'))
      .join('\n');
    for (const hidden of [
      'SECRET-THINKING-TEXT',
      'SECRET-TOOL-OUTPUT',
      'Caveat',
      'SECRET-SUMMARY',
      'SECRET-SYSTEM',
      'weird',
    ]) {
      expect(all).not.toContain(hidden);
    }
    expect(mapEntry({ weird: 'shape', uuid: 'x' })).toEqual([]);
    expect(mapEntry(null)).toEqual([]);
    expect(mapEntry({ type: 'assistant', uuid: 'x', message: { content: 'not an array' } })).toEqual([]);
  });

  it("an other tool's summary is the first 200 chars of its input JSON", () => {
    const input = (n: number) => ({ q: 'a'.repeat(n - '{"q":""}'.length) });
    const run = (n: number) =>
      mapEntry({
        type: 'assistant',
        uuid: 'a1',
        message: { content: [{ type: 'tool_use', name: 'Other', input: input(n) }] },
      });
    expect(JSON.stringify(input(200))).toHaveLength(200);
    expect(run(200)[0]?.text).toBe(JSON.stringify(input(200)));
    expect(run(201)[0]?.text).toBe(JSON.stringify(input(201)).slice(0, 200));
  });

  it('cuts at 8000 bytes with truncated', () => {
    const encode = (t: string) => Buffer.from(JSON.stringify({ text: t })).toString('base64');
    expect(fitText('a'.repeat(8000), encode)).toEqual({ text: 'a'.repeat(8000), truncated: false });
    const cut = fitText('a'.repeat(8001), encode);
    expect(cut.truncated).toBe(true);
    expect(Buffer.byteLength(cut.text)).toBeLessThanOrEqual(8000);
    const line = wireLine({ id: 'a', kind: 'agent', text: 'a'.repeat(8001) });
    expect(decode(line).truncated).toBe(true);
    expect(decode(wireLine({ id: 'a', kind: 'agent', text: 'a'.repeat(8000) })).truncated).toBeUndefined();
  });

  it('cuts on a code point boundary', () => {
    const encode = (t: string) => Buffer.from(JSON.stringify({ text: t })).toString('base64');
    expect(fitText('a'.repeat(7999) + '😀', encode)).toEqual({ text: 'a'.repeat(7999), truncated: true });
    const entry = decode(wireLine({ id: 'a', kind: 'agent', text: 'a'.repeat(7999) + '😀' }));
    expect(entry.text).toBe('a'.repeat(7999));
    expect(entry.truncated).toBe(true);
  });

  it.each([
    ['quotes', '"'.repeat(8000)],
    ['newlines', '\n'.repeat(8000)],
  ])('the encoded line of a quote-heavy 8,000-byte message stays within 12,000 base64 chars (%s)', (_n, text) => {
    const line = wireLine({ id: 'a1:0', at: at(1), kind: 'agent', text });
    const body = line.replace('agentdesk: transcript ', '');
    expect(body.length).toBeLessThanOrEqual(12000);
    const entry = decode(line);
    expect(entry.truncated).toBe(true);
    expect(entry.text.length).toBeGreaterThan(0);
    expect(entry.text).toBe(text.slice(0, entry.text.length));
  });

  it('keeps offsets across two runs (resume)', async () => {
    const path = await copyFixture('session.jsonl');
    sendNew({ paths: [path], stateDir, out });
    const first = (await sent()).length;
    expect(sendNew({ paths: [path], stateDir, out })).toBe(0);
    await appendFile(
      path,
      `${JSON.stringify({ type: 'user', uuid: 'n1', message: { content: 'more' } })}\n${JSON.stringify({ type: 'assistant', uuid: 'n2', message: { content: [{ type: 'text', text: 'ok' }] } })}\n`,
    );
    expect(sendNew({ paths: [path], stateDir, out })).toBe(2);
    const all = await sent();
    expect(all).toHaveLength(first + 2);
    expect(all.slice(-2).map((e) => e.id)).toEqual(['n1:0', 'n2:0']);
  });

  it('does not send a partial last line until it is complete', async () => {
    const path = join(home, 'p.jsonl');
    const line = JSON.stringify({ type: 'user', uuid: 'p1', message: { content: 'hi' } });
    await writeFile(path, line.slice(0, 10));
    expect(sendNew({ paths: [path], stateDir, out })).toBe(0);
    await writeFile(path, `${line}\n`);
    expect(sendNew({ paths: [path], stateDir, out })).toBe(1);
  });

  it('the lock stops a concurrent send from sending an entry twice', async () => {
    const path = await copyFixture('session.jsonl');
    await mkdir(stateDir, { recursive: true });
    const lock = join(stateDir, 'transcript.lock');
    await writeFile(lock, 'held');
    expect(sendNew({ paths: [path], stateDir, out })).toBe(0);
    expect(await sent()).toEqual([]);
    const old = new Date(Date.now() - 10 * 60_000);
    await utimes(lock, old, old);
    expect(sendNew({ paths: [path], stateDir, out })).toBeGreaterThan(0);
    expect(existsSync(lock)).toBe(false);
  });

  it('a send with waitMs waits for a lock that is released and then sends', async () => {
    const path = await copyFixture('session.jsonl');
    await mkdir(stateDir, { recursive: true });
    const lock = join(stateDir, 'transcript.lock');
    await writeFile(lock, 'held');
    const release = `setTimeout(() => require('node:fs').unlinkSync(${JSON.stringify(lock)}), 200)`;
    const child = spawn(process.execPath, ['-e', release], { stdio: 'ignore' });
    try {
      expect(sendNew({ paths: [path], stateDir, out, waitMs: 2000 })).toBeGreaterThan(0);
    } finally {
      child.kill();
    }
  });

  it('a send with waitMs gives up after the wait when the lock stays fresh', async () => {
    const path = await copyFixture('session.jsonl');
    await mkdir(stateDir, { recursive: true });
    await writeFile(join(stateDir, 'transcript.lock'), 'held');
    const started = Date.now();
    expect(sendNew({ paths: [path], stateDir, out, waitMs: 300 })).toBe(0);
    expect(Date.now() - started).toBeGreaterThanOrEqual(250);
  });

  it('flush takes over a lock left by a killed hook after a few seconds', async () => {
    const repo = join(home, 'work', 'my.repo');
    await mkdir(repo, { recursive: true });
    const projectDir = join(home, '.claude', 'projects', repo.replace(/[^A-Za-z0-9]/g, '-'));
    await mkdir(projectDir, { recursive: true });
    await copyFixture('session.jsonl', join(projectDir, 's.jsonl'));
    await mkdir(stateDir, { recursive: true });
    const lock = join(stateDir, 'transcript.lock');
    await writeFile(lock, 'held');
    const old = new Date(Date.now() - 4000);
    await utimes(lock, old, old);
    const r = spawnSync(process.execPath, [script, 'flush'], {
      cwd: repo,
      encoding: 'utf8',
      env: { PATH: process.env.PATH, HOME: home, AGENTDESK_STATUS_OUT: out },
    });
    expect(r.status).toBe(0);
    expect((await sent()).map((e) => e.id)).toContain('u1:0');
  });

  it('flush sends recorded paths plus the newest session file and exits 0 within 5 s', async () => {
    const repo = join(home, 'work', 'my.repo');
    await mkdir(repo, { recursive: true });
    const projectDir = join(home, '.claude', 'projects', repo.replace(/[^A-Za-z0-9]/g, '-'));
    await mkdir(projectDir, { recursive: true });
    const recorded = await copyFixture('session.jsonl', join(projectDir, 'old.jsonl'));
    const newest = await copyFixture('continue.jsonl', join(projectDir, 'new.jsonl'));
    const past = new Date(Date.now() - 60_000);
    await utimes(recorded, past, past);
    await mkdir(stateDir, { recursive: true });
    await writeFile(join(stateDir, 'transcript.json'), JSON.stringify({ files: { [recorded]: { offset: 0 } } }));
    const started = Date.now();
    const r = spawnSync(process.execPath, [script, 'flush'], {
      cwd: repo,
      encoding: 'utf8',
      env: { PATH: process.env.PATH, HOME: home, AGENTDESK_STATUS_OUT: out },
    });
    expect(r.status).toBe(0);
    expect(Date.now() - started).toBeLessThan(5000);
    const ids = (await sent()).map((e) => e.id);
    expect(ids).toContain('u1:0');
    expect(ids).toContain('c1:0');
    expect(existsSync(newest)).toBe(true);
  });

  it('transcriptStep ignores a transcript_path outside HOME and never throws on bad input', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'outside-'));
    const outsideFile = await copyFixture('session.jsonl', join(outside, 's.jsonl'));
    const env = { HOME: home, AGENTDESK_STATE_DIR: stateDir, AGENTDESK_STATUS_OUT: out };
    transcriptStep({ transcript_path: outsideFile }, env);
    expect(await sent()).toEqual([]);
    expect(() => transcriptStep(null, env)).not.toThrow();
    expect(() => transcriptStep({ transcript_path: 42 }, env)).not.toThrow();
    expect(() => transcriptStep({ transcript_path: home }, env)).not.toThrow();
    const inside = await copyFixture('continue.jsonl');
    transcriptStep({ transcript_path: inside }, env);
    expect((await sent()).map((e) => e.id)).toEqual(['c1:0', 'c2:0']);
    expect(JSON.parse(await readFile(join(stateDir, 'transcript.json'), 'utf8'))).toMatchObject({
      files: { [inside]: { offset: expect.any(Number) as number } },
    });
  });
});
