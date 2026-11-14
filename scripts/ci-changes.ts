// Decides whether a change needs the code gates (lint, typecheck, tests, coverage) or only the format check.
// Usage: tsx scripts/ci-changes.ts <base-ref>   (prints `code=true` or `code=false` for $GITHUB_OUTPUT)
// Fails safe: anything unrecognised, or an empty diff, counts as code.
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

// A file is docs-only when it is Markdown (docs, agent skills, READMEs). Only Markdown: a script or config under
// docs/ or .agent/ could still change behaviour. Markdown under .github/ other than the PR template is treated as code.
function isDocsOnly(file: string): boolean {
  if (!file.endsWith('.md')) return false;
  return !file.startsWith('.github/') || file === '.github/pull_request_template.md';
}

export function needsCodeGates(files: readonly string[]): boolean {
  if (files.length === 0) return true;
  return files.some((f) => !isDocsOnly(f));
}

export function parseChangedFiles(output: string): string[] {
  return output.split('\n').filter((line) => line.length > 0);
}

function main(): void {
  const base = process.argv[2];
  if (base === undefined || base === '') throw new Error('usage: ci-changes.ts <base-ref>');
  const out = execFileSync('git', ['diff', '--name-only', `${base}...HEAD`], { encoding: 'utf8' });
  process.stdout.write(`code=${needsCodeGates(parseChangedFiles(out))}\n`);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) main();
