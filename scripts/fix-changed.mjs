#!/usr/bin/env node
// Auto-fix ONLY the files changed in the working tree (staged, unstaged, untracked) — never the whole repo.
// 1. prettier --write   2. eslint --fix (per package that has an eslint.config.*)   3. re-stage files that were staged
// 4. report what still fails, so the author fixes only what the tools could not.
//
// Usage: node scripts/fix-changed.mjs [--staged]   (--staged: only files already in the index)
// Via devbox: devbox run fix | devbox run fix-staged
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
process.chdir(root);

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).split('\0').filter(Boolean);
const stagedOnly = process.argv.includes('--staged');

const staged = git('diff', '--name-only', '--cached', '--diff-filter=ACMR', '-z');
const files = stagedOnly
  ? staged
  : [
      ...new Set([
        ...staged,
        ...git('diff', '--name-only', '--diff-filter=ACMR', '-z'),
        ...git('ls-files', '--others', '--exclude-standard', '-z'),
      ]),
    ];
const existing = files.filter((f) => existsSync(f));

if (existing.length === 0) {
  console.log('fix: no changed files.');
  process.exit(0);
}
console.log(`fix: ${existing.length} changed file(s)`);

const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { stdio: 'inherit', ...opts }).status ?? 1;
let failed = false;

// 1. Prettier (respects .prettierignore; skips files it has no parser for).
if (run('pnpm', ['exec', 'prettier', '--write', '--ignore-unknown', '--log-level', 'warn', ...existing]) !== 0) {
  failed = true;
}

// 2. ESLint --fix, grouped by the nearest directory that has its own eslint.config.*.
const lintable = /\.(c|m)?(j|t)sx?$/;
const configNames = ['eslint.config.js', 'eslint.config.mjs', 'eslint.config.cjs', 'eslint.config.ts'];
const findConfigDir = (file) => {
  for (let dir = path.dirname(file); ; dir = path.dirname(dir)) {
    if (configNames.some((n) => existsSync(path.join(dir, n)))) return dir;
    if (dir === '.' || dir === path.dirname(dir)) return null;
  }
};
const groups = new Map();
for (const f of existing.filter((f) => lintable.test(f))) {
  const dir = findConfigDir(f);
  if (dir === null) continue; // package has no ESLint yet
  if (!groups.has(dir)) groups.set(dir, []);
  groups.get(dir).push(path.relative(dir, f));
}
for (const [dir, rel] of groups) {
  console.log(`fix: eslint --fix in ${dir} (${rel.length} file(s))`);
  if (run('pnpm', ['exec', 'eslint', '--fix', '--no-warn-ignored', ...rel], { cwd: dir }) !== 0) failed = true;
}

// 3. Re-stage files that were staged before, so the commit gets the fixed content.
const toRestage = staged.filter((f) => existsSync(f));
if (toRestage.length > 0) execFileSync('git', ['add', '--', ...toRestage]);

// 4. Result.
if (failed) {
  console.error(
    '\nfix: issues remain that the tools cannot fix automatically (see above). Fix only those, then rerun.',
  );
  process.exit(1);
}
console.log('fix: clean.');
