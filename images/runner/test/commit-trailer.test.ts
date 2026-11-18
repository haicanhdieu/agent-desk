import { execFileSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const hook = join(import.meta.dirname, '..', 'hooks', 'prepare-commit-msg');
const BOT = { BOT_NAME: 'agentdesk[bot]', BOT_EMAIL: 'bot@users.noreply.github.com' };

/** A real git repo configured the way the entrypoint configures a run's repo. Nothing touches the network. */
function repo(author = { name: 'alice', email: '42+alice@users.noreply.github.com' }) {
  const dir = mkdtempSync(join(tmpdir(), 'trailer-'));
  const git = (args: string[], env: Record<string, string> = {}): string =>
    execFileSync('git', args, {
      cwd: dir,
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH ?? '',
        HOME: dir,
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_CONFIG_GLOBAL: '/dev/null',
        ...env,
      },
    });
  git(['init', '--quiet']);
  git(['config', 'user.name', author.name]);
  git(['config', 'user.email', author.email]);
  // Installed the way the entrypoint does it: a copy in the repo's own hooks dir, no core.hooksPath.
  copyFileSync(hook, join(dir, '.git', 'hooks', 'prepare-commit-msg'));
  chmodSync(join(dir, '.git', 'hooks', 'prepare-commit-msg'), 0o755);
  return { dir, git };
}

describe('prepare-commit-msg hook', () => {
  it('commits as the author for both author and committer, with the bot only as a trailer', () => {
    const { git } = repo();
    git(['commit', '--allow-empty', '--quiet', '-m', 'fix: a thing'], BOT);
    expect(git(['log', '-1', '--format=%an <%ae>|%cn <%ce>']).trim()).toBe(
      'alice <42+alice@users.noreply.github.com>|alice <42+alice@users.noreply.github.com>',
    );
    const body = git(['log', '-1', '--format=%B']).trim();
    expect(body).toBe('fix: a thing\n\nCo-Authored-By: agentdesk[bot] <bot@users.noreply.github.com>');
  });

  it('adds the trailer once, also after an amend', () => {
    const { git } = repo();
    git(['commit', '--allow-empty', '--quiet', '-m', 'fix: a thing'], BOT);
    git(['commit', '--amend', '--allow-empty', '--quiet', '-m', 'fix: another thing'], BOT);
    git(['commit', '--amend', '--allow-empty', '--quiet', '--no-edit'], BOT);
    const body = git(['log', '-1', '--format=%B']);
    expect(body.match(/Co-Authored-By:/g)).toHaveLength(1);
    expect(body.trim().split('\n').at(-1)).toBe('Co-Authored-By: agentdesk[bot] <bot@users.noreply.github.com>');
  });

  it('keeps a message that has a --- line intact and still ends with the trailer', () => {
    const { git } = repo();
    git(['commit', '--allow-empty', '--quiet', '-m', 'fix: a thing\n\n---\nnotes'], BOT);
    const body = git(['log', '-1', '--format=%B']).trim();
    expect(body).toContain('---\nnotes');
    expect(body.split('\n').at(-1)).toBe('Co-Authored-By: agentdesk[bot] <bot@users.noreply.github.com>');
  });

  it('never runs a shell metacharacter in the bot name', () => {
    const { dir, git } = repo();
    git(['commit', '--allow-empty', '--quiet', '-m', 'x'], {
      BOT_NAME: 'x"; touch pwned #',
      BOT_EMAIL: 'a$(touch pwned2)@x.invalid',
    });
    expect(existsSync(join(dir, 'pwned'))).toBe(false);
    expect(existsSync(join(dir, 'pwned2'))).toBe(false);
    expect(git(['log', '-1', '--format=%B'])).toContain(
      'Co-Authored-By: x"; touch pwned # <a$(touch pwned2)@x.invalid>',
    );
  });

  it('still adds the bot trailer when the bot is also the author (the fallback identity): every agent commit has it', () => {
    const { git } = repo({ name: 'agentdesk[bot]', email: 'bot@users.noreply.github.com' });
    git(['commit', '--allow-empty', '--quiet', '-m', 'fix: a thing'], BOT);
    const body = git(['log', '-1', '--format=%B']);
    expect(body.match(/Co-Authored-By:/g)).toHaveLength(1);
  });

  it("leaves the repo's other hooks running (no core.hooksPath replaces them)", () => {
    const { dir, git } = repo();
    const pre = join(dir, '.git', 'hooks', 'pre-commit');
    writeFileSync(pre, '#!/bin/sh\ntouch "$(dirname "$0")/../pre-commit-ran"\n');
    chmodSync(pre, 0o755);
    git(['commit', '--allow-empty', '--quiet', '-m', 'x'], BOT);
    expect(existsSync(join(dir, '.git', 'pre-commit-ran'))).toBe(true);
  });

  it("runs the repo's own prepare-commit-msg (kept next to it as prepare-commit-msg.repo) before adding the trailer", () => {
    const { dir, git } = repo();
    const own = join(dir, '.git', 'hooks', 'prepare-commit-msg.repo');
    writeFileSync(own, '#!/bin/sh\nprintf "[ticket-1] " | cat - "$1" > "$1.new" && mv "$1.new" "$1"\n');
    chmodSync(own, 0o755);
    git(['commit', '--allow-empty', '--quiet', '-m', 'fix: a thing'], BOT);
    const body = git(['log', '-1', '--format=%B']).trim();
    expect(body).toBe('[ticket-1] fix: a thing\n\nCo-Authored-By: agentdesk[bot] <bot@users.noreply.github.com>');
  });

  it("stops the commit when the repo's own prepare-commit-msg fails", () => {
    const { dir, git } = repo();
    const own = join(dir, '.git', 'hooks', 'prepare-commit-msg.repo');
    writeFileSync(own, '#!/bin/sh\nexit 1\n');
    chmodSync(own, 0o755);
    expect(() => git(['commit', '--allow-empty', '--quiet', '-m', 'x'], BOT)).toThrow();
  });

  it('adds no trailer when the bot identity is not set', () => {
    const { git } = repo();
    git(['commit', '--allow-empty', '--quiet', '-m', 'plain']);
    expect(git(['log', '-1', '--format=%B']).trim()).toBe('plain');
  });
});
