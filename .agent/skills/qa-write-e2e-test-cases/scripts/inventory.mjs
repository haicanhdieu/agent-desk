#!/usr/bin/env node
// Lists the titles of every existing test in the repo, so agents can check for
// duplicates without opening implementation code.
//
//   node inventory.mjs <workdir>      -> writes <workdir>/inventory.json
//
// Only test files are opened, and only describe/it/test titles are extracted.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const workdir = process.argv[2];
if (!workdir) {
  console.error('usage: node inventory.mjs <workdir>');
  process.exit(2);
}

const TEST_FILE = /\.(spec|test)\.(ts|tsx|mts|cts|js|jsx|mjs)$/;
const TITLE = /\b(describe|it|test)((?:\.[a-zA-Z]+)*)\s*\(\s*(['"`])((?:\\.|(?!\3)[^\\\n])*)\3/g;

const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
})
  .split('\n')
  .filter((file) => TEST_FILE.test(file));

const entries = [];
for (const file of files) {
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    continue;
  }
  const layer = /(^|\/)e2e\//.test(file) || /\.e2e\./.test(file) ? 'e2e' : 'lower';
  const lines = text.split('\n');
  lines.forEach((line, index) => {
    for (const match of line.matchAll(TITLE)) {
      const title = match[4].replace(/\\(['"`])/g, '$1').trim();
      if (!title) continue;
      entries.push({
        file,
        line: index + 1,
        kind: match[1] === 'describe' || match[2].includes('describe') ? 'suite' : 'test',
        layer,
        title,
        ref: `${file} › ${title}`,
      });
    }
  });
}

mkdirSync(workdir, { recursive: true });
const out = join(workdir, 'inventory.json');
writeFileSync(out, JSON.stringify(entries, null, 2) + '\n');
const e2e = entries.filter((entry) => entry.layer === 'e2e' && entry.kind === 'test').length;
console.log(`inventory: ${entries.length} titles from ${files.length} test files (${e2e} e2e tests) -> ${out}`);
