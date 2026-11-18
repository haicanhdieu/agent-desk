import { execFile, spawn } from 'node:child_process';
import { chmod, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

const wrapperDir = join(import.meta.dirname, '..', 'bin');
const PR_URL = 'https://github.com/o/r/pull/5';

// A stand-in for the real gh: it logs every call and keeps one PR body in $STUB_BODY_FILE.
//   pr create     prints a progress line, then the PR url (exit $STUB_CREATE_EXIT)
//   pr view       prints the stored body (exit 1 when $STUB_VIEW_FAIL is set)
//   pr edit       --body / --body-file replace the stored body (exit 1 when $STUB_EDIT_FAIL is set)
//   anything else prints "plain" and exits 0
const STUB = `#!/usr/bin/env node
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
const argv = process.argv.slice(2);
appendFileSync(process.env.STUB_LOG, JSON.stringify(argv) + '\\n');
const flag = (n) => { const i = argv.indexOf(n); return i < 0 ? undefined : argv[i + 1]; };
if (argv[0] === 'pr' && argv[1] === 'create') {
  console.log('Creating pull request for b into main in o/r');
  await new Promise((r) => setTimeout(r, Number(process.env.STUB_CREATE_DELAY_MS ?? 0)));
  console.log(process.env.STUB_PR_URL);
  process.exit(Number(process.env.STUB_CREATE_EXIT ?? 0));
} else if (argv[0] === 'pr' && argv[1] === 'view') {
  if (process.env.STUB_VIEW_FAIL) { console.error('no pull request found'); process.exit(1); }
  process.stdout.write(readFileSync(process.env.STUB_BODY_FILE, 'utf8'));
} else if (argv[0] === 'pr' && argv[1] === 'edit') {
  if (process.env.STUB_EDIT_FAIL && flag('--body-file') !== undefined) { console.error('edit failed'); process.exit(1); }
  if (flag('--body-file') !== undefined) writeFileSync(process.env.STUB_BODY_FILE, readFileSync(flag('--body-file'), 'utf8'));
  else if (flag('--body') !== undefined) writeFileSync(process.env.STUB_BODY_FILE, flag('--body'));
} else {
  console.log('plain');
}
`;

async function setup(initialBody = 'Fixes the thing.\n') {
  const dir = await mkdtemp(join(tmpdir(), 'gh-auth-'));
  await writeFile(join(dir, 'gh'), STUB);
  await chmod(join(dir, 'gh'), 0o755);
  const bodyFile = join(dir, 'body');
  const logFile = join(dir, 'log');
  await writeFile(bodyFile, initialBody);
  await writeFile(logFile, '');
  const env = (extra: Record<string, string> = {}): Record<string, string> => ({
    PATH: `${wrapperDir}:${dir}:${dirname(process.execPath)}:/usr/bin:/bin`,
    STUB_LOG: logFile,
    STUB_BODY_FILE: bodyFile,
    STUB_PR_URL: PR_URL,
    ...extra,
  });
  const run = (args: string[], extra: Record<string, string> = {}) =>
    new Promise<{ stdout: string; stderr: string; code: number }>((resolve, reject) => {
      execFile('gh', args, { env: env(extra), timeout: 15_000 }, (err, stdout, stderr) => {
        if (err && typeof err.code !== 'number') reject(err);
        else resolve({ stdout, stderr, code: typeof err?.code === 'number' ? err.code : 0 });
      });
    });
  const body = () => readFile(bodyFile, 'utf8');
  const calls = async () =>
    (await readFile(logFile, 'utf8'))
      .split('\n')
      .filter((l) => l !== '')
      .map((l) => JSON.parse(l) as string[]);
  return { run, body, calls, dir };
}

const AUTH = (login: string) => ({ RUN_AUTHORIZED_BY: login });
const count = (s: string, needle: string) => s.split(needle).length - 1;

describe('gh wrapper Authorized by line', () => {
  it('after pr create, appends the line with the login in backticks and keeps stdout and exit code', async () => {
    const t = await setup();
    const r = await t.run(['pr', 'create', '--title', 'x', '--body', 'y'], AUTH('alice'));
    expect(r.code).toBe(0);
    expect(r.stdout).toBe(`Creating pull request for b into main in o/r\n${PR_URL}\n`);
    expect(await t.body()).toBe('Fixes the thing.\n\nAuthorized by `alice`\n');
    const edit = (await t.calls()).find((a) => a[0] === 'pr' && a[1] === 'edit');
    expect(edit?.slice(0, 3)).toEqual(['pr', 'edit', PR_URL]);
    expect(edit).toContain('--body-file');
  });

  it('streams the output of pr create while it runs instead of printing it all after it exits', async () => {
    const t = await setup();
    const child = spawn('gh', ['pr', 'create'], {
      env: {
        PATH: `${wrapperDir}:${t.dir}:${dirname(process.execPath)}:/usr/bin:/bin`,
        STUB_LOG: join(t.dir, 'log'),
        STUB_BODY_FILE: join(t.dir, 'body'),
        STUB_PR_URL: PR_URL,
        STUB_CREATE_DELAY_MS: '1500',
        ...AUTH('alice'),
      },
    });
    const start = Date.now();
    const firstChunkAt = await new Promise<number>((resolve) =>
      child.stdout.once('data', () => resolve(Date.now() - start)),
    );
    await new Promise((resolve) => child.on('close', resolve));
    expect(firstChunkAt).toBeLessThan(1000);
    expect(await t.body()).toBe('Fixes the thing.\n\nAuthorized by `alice`\n');
  });

  it('does nothing extra for pr create --web (no PR exists yet)', async () => {
    const t = await setup();
    const web = await t.run(['pr', 'create', '--web'], AUTH('alice'));
    expect(web.stdout).toContain(PR_URL);
    expect((await t.calls()).map((a) => a[1])).toEqual(['create']);
    expect(await t.body()).toBe('Fixes the thing.\n');
  });

  it('replaces an Authorized by line the agent wrote instead of adding a second one', async () => {
    const t = await setup('Fixes the thing.\n\nAuthorized by `mallory`\n');
    await t.run(['pr', 'create', '--title', 'x'], AUTH('alice'));
    const body = await t.body();
    expect(body).toBe('Fixes the thing.\n\nAuthorized by `alice`\n');
    expect(body).not.toContain('mallory');
  });

  it('is idempotent when the agent edits the PR again', async () => {
    const t = await setup();
    await t.run(['pr', 'create', '--title', 'x'], AUTH('alice'));
    await t.run(['pr', 'edit', '5', '--title', 'y'], AUTH('alice'));
    await t.run(['pr', 'edit', '5', '--title', 'z'], AUTH('alice'));
    expect(count(await t.body(), 'Authorized by')).toBe(1);
    expect(await t.body()).toBe('Fixes the thing.\n\nAuthorized by `alice`\n');
  });

  it('after pr edit with a new body, the line is put back even though the agent dropped it', async () => {
    const t = await setup('old\n\nAuthorized by `alice`\n');
    await t.run(['pr', 'edit', '5', '--body', 'brand new body'], AUTH('alice'));
    expect(await t.body()).toBe('brand new body\n\nAuthorized by `alice`\n');
    const view = (await t.calls()).find((a) => a[1] === 'view');
    expect(view?.[2]).toBe('5');
  });

  it('with no PR argument, edit looks the PR up by the current branch', async () => {
    const t = await setup();
    await t.run(['pr', 'edit', '--title', 'y'], AUTH('alice'));
    const calls = await t.calls();
    expect(calls.find((a) => a[1] === 'view')).toEqual(['pr', 'view', '--json', 'body', '-q', '.body']);
    expect(calls.at(-1)?.slice(0, 2)).toEqual(['pr', 'edit']);
    expect(calls.at(-1)).not.toContain('--title');
    expect(await t.body()).toBe('Fixes the thing.\n\nAuthorized by `alice`\n');
  });

  it('passes --repo on to the follow-up calls', async () => {
    const t = await setup();
    await t.run(['pr', 'edit', '5', '--repo', 'o/r', '--title', 'y'], AUTH('alice'));
    const calls = await t.calls();
    expect(calls.find((a) => a[1] === 'view')).toContain('o/r');
    expect(calls.at(-1)).toContain('o/r');
  });

  it('writes the bot login when the bot authorized the run', async () => {
    const t = await setup();
    await t.run(['pr', 'create'], AUTH('agentdesk[bot]'));
    expect(await t.body()).toBe('Fixes the thing.\n\nAuthorized by `agentdesk[bot]`\n');
  });

  it('makes no edit call for an invalid login, and never executes it', async () => {
    for (const bad of ['a;b', '$(touch pwned)', 'a b', '--flag', 'a\nb', '-x', '']) {
      const t = await setup();
      const r = await t.run(['pr', 'create'], AUTH(bad));
      expect(r.code).toBe(0);
      expect((await t.calls()).filter((a) => a[1] === 'edit' || a[1] === 'view')).toEqual([]);
      expect(await t.body()).toBe('Fixes the thing.\n');
    }
  });

  it('does nothing without RUN_AUTHORIZED_BY', async () => {
    const t = await setup();
    await t.run(['pr', 'create']);
    expect((await t.calls()).map((a) => a[1])).toEqual(['create']);
  });

  it('passes other subcommands through untouched', async () => {
    const t = await setup();
    const r = await t.run(['issue', 'list'], AUTH('alice'));
    expect(r).toMatchObject({ stdout: 'plain\n', code: 0 });
    await t.run(['pr', 'view', '5'], AUTH('alice'));
    await t.run(['pr', 'list'], AUTH('alice'));
    expect((await t.calls()).map((a) => a.join(' '))).toEqual(['issue list', 'pr view 5', 'pr list']);
  });

  it('does not touch the PR when the agent command fails, and keeps its exit code', async () => {
    const t = await setup();
    const r = await t.run(['pr', 'create'], { ...AUTH('alice'), STUB_CREATE_EXIT: '3' });
    expect(r.code).toBe(3);
    expect((await t.calls()).map((a) => a[1])).toEqual(['create']);
  });

  it('warns on stderr but succeeds when the follow-up edit fails', async () => {
    const t = await setup();
    const r = await t.run(['pr', 'create'], { ...AUTH('alice'), STUB_EDIT_FAIL: '1' });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain(PR_URL);
    expect(r.stderr).toContain('Authorized by');
  });

  it('warns but succeeds when the PR body cannot be read', async () => {
    const t = await setup();
    const r = await t.run(['pr', 'create'], { ...AUTH('alice'), STUB_VIEW_FAIL: '1' });
    expect(r.code).toBe(0);
    expect(r.stderr).toContain('Authorized by');
    expect((await t.calls()).some((a) => a[1] === 'edit')).toBe(false);
  });
});
