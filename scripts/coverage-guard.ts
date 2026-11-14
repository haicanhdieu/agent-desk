// Anti-gaming guard for the coverage gate. Fails a PR that hides code from coverage or lowers the bar without a written
// reason, and tells reviewers which protected coverage files the PR touches.
//
// Usage: PR_BODY=... tsx scripts/coverage-guard.ts <pr.diff> [--base-dir <dir>]
//   <pr.diff>   `git diff --unified=0 origin/<base>...HEAD`
//   --base-dir  directory holding the base-branch copies of the changed protected files, at their repo-relative paths
//               (a file that is missing there is read as "no previous version", e.g. its first introduction)
//   PR_BODY     the PR description. It is untrusted text: it is only read from the environment here, never put in a
//               shell command.
//
// Rules that fail (each needs a `## Coverage exceptions` section in the PR body to pass):
//   a. an added coverage ignore comment (v8 / c8 / istanbul) in a source or test file;
//   b. a coverage config that widens exclusion: an entry added to `coverage.exclude`, or removed from `coverage.include`;
//   c. a lowered or removed value, package, sensitive group or glob in coverage-thresholds.json.
// Editing a protected file alone does not fail; it prints a notice so a human reviews it (see dev-review SKILL.md).
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';

export const EXCEPTIONS_HEADING = '## Coverage exceptions';
const MIN_JUSTIFICATION_CHARS = 20;

export interface DiffFile {
  path: string;
  added: string[];
  removed: string[];
}
export interface Violation {
  file: string;
  message: string;
}

const SOURCE_FILE = /\.[cm]?[jt]sx?$/;
const IGNORE_COMMENT = /(?:\/\/|\/\*)\s*(?:v8|c8|istanbul)\s+ignore\b/;
const CONFIG_FILE = /(?:^|\/)(?:vitest|vite)\.config\.[cm]?[jt]s$/;
const THRESHOLDS_FILE = 'coverage-thresholds.json';
const PROTECTED_EXACT = new Set([THRESHOLDS_FILE, 'coverage-baseline.json', '.github/workflows/ci.yml']);
const PROTECTED_SCRIPT = /^scripts\/coverage-[^/]+\.ts$/;

export function parseDiff(diff: string): DiffFile[] {
  const files: DiffFile[] = [];
  let current: DiffFile | undefined;
  let inHeader = false;
  let oldPath = '';
  const cleanPath = (raw: string): string =>
    raw
      .replace(/^"/, '')
      .replace(/"$/, '')
      .replace(/^[ab]\//, '');
  for (const line of diff.split(/\r?\n/)) {
    if (line.startsWith('diff --git ')) {
      inHeader = true;
      current = undefined;
      oldPath = '';
    } else if (inHeader && line.startsWith('--- ')) {
      oldPath = line.slice(4);
    } else if (inHeader && line.startsWith('+++ ')) {
      const next = line.slice(4);
      current = { path: cleanPath(next === '/dev/null' ? oldPath : next), added: [], removed: [] };
      files.push(current);
    } else if (line.startsWith('@@')) {
      inHeader = false;
    } else if (!inHeader && current !== undefined) {
      if (line.startsWith('+')) current.added.push(line.slice(1));
      else if (line.startsWith('-')) current.removed.push(line.slice(1));
    }
  }
  return files;
}

export function checkIgnoreComments(files: DiffFile[]): Violation[] {
  const out: Violation[] = [];
  for (const f of files) {
    if (!SOURCE_FILE.test(f.path)) continue;
    for (const line of f.added) {
      if (IGNORE_COMMENT.test(line)) {
        out.push({
          file: f.path,
          message: `added coverage ignore comment: ${line.trim()}. Cover the code with a test instead, or justify it`,
        });
      }
    }
  }
  return out;
}

export function hasJustification(prBody: string): boolean {
  const lines = prBody.replace(/<!--[\s\S]*?-->/g, '').split(/\r?\n/);
  const start = lines.findIndex((l) => /^\s{0,3}##\s+coverage exceptions\s*#*\s*$/i.test(l));
  if (start < 0) return false;
  const section: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^\s{0,3}#{1,6}\s/.test(line)) break;
    section.push(line);
  }
  const text = section
    .join('\n')
    .replace(/\b(?:n\/a|na|none|nothing|tbd|todo)\b/gi, '')
    .replace(/\s+/g, '');
  return text.length >= MIN_JUSTIFICATION_CHARS;
}

// Config parsing, kept deliberately simple: the vitest config is never executed (that is heavy and runs arbitrary
// code). Instead the text is scanned: comments are dropped (string-aware), the `coverage: { ... }` block is found by
// brace matching, and the `include` / `exclude` arrays inside it are read as string literals. Any non-literal entry
// (a spread, a variable) is kept as `<expr:...>` so it cannot hide an exclusion. Compared as sets between base and PR.
function stripComments(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const c = text.charAt(i);
    const next = text.charAt(i + 1);
    if (c === '/' && next === '/') {
      while (i < text.length && text.charAt(i) !== '\n') i++;
      out += '\n';
    } else if (c === '/' && next === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end < 0 ? text.length : end + 1;
      out += ' ';
    } else if (c === "'" || c === '"' || c === '`') {
      const end = skipString(text, i);
      out += text.slice(i, end + 1);
      i = end;
    } else out += c;
  }
  return out;
}

/** Index of the closing quote of the string literal starting at `start`. */
function skipString(text: string, start: number): number {
  const quote = text.charAt(start);
  let i = start + 1;
  while (i < text.length && text.charAt(i) !== quote) i += text.charAt(i) === '\\' ? 2 : 1;
  return Math.min(i, text.length - 1);
}

/** Index of the bracket matching the opener at `open` (strings skipped), or -1. */
function matchBracket(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const c = text.charAt(i);
    if (c === "'" || c === '"' || c === '`') i = skipString(text, i);
    else if (c === '{' || c === '[' || c === '(') depth++;
    else if (c === '}' || c === ']' || c === ')') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function arrayEntries(body: string): string[] {
  const entries: string[] = [];
  let i = 0;
  while (i < body.length) {
    const c = body.charAt(i);
    if (/[\s,]/.test(c)) i++;
    else if (c === "'" || c === '"' || c === '`') {
      const end = skipString(body, i);
      entries.push(body.slice(i + 1, end));
      i = end + 1;
    } else {
      let j = i;
      while (j < body.length && body.charAt(j) !== ',') {
        const d = body.charAt(j);
        j =
          d === '(' || d === '[' || d === '{'
            ? matchBracket(body, j)
            : d === "'" || d === '"'
              ? skipString(body, j)
              : j;
        if (j < 0) j = body.length;
        j++;
      }
      entries.push(`<expr:${body.slice(i, j).trim()}>`);
      i = j;
    }
  }
  return entries;
}

export interface CoverageLists {
  include: string[];
  exclude: string[];
}

export function extractCoverageLists(configText: string): CoverageLists {
  const text = stripComments(configText);
  const lists: CoverageLists = { include: [], exclude: [] };
  const start = /\bcoverage\s*:\s*\{/.exec(text);
  if (start === null) return lists;
  const open = start.index + start[0].length - 1;
  const block = text.slice(open, matchBracket(text, open) + 1);
  for (const key of ['include', 'exclude'] as const) {
    const m = new RegExp(`\\b${key}\\s*:\\s*\\[`).exec(block);
    if (m === null) continue;
    const arrOpen = m.index + m[0].length - 1;
    const arrEnd = matchBracket(block, arrOpen);
    lists[key] = arrayEntries(block.slice(arrOpen + 1, arrEnd < 0 ? block.length : arrEnd));
  }
  return lists;
}

export function checkConfigWidening(file: string, baseText: string | undefined, prText: string): Violation[] {
  if (baseText === undefined) return [];
  const base = extractCoverageLists(baseText);
  const pr = extractCoverageLists(prText);
  const out: Violation[] = [];
  for (const e of pr.exclude) {
    if (!base.exclude.includes(e))
      out.push({ file, message: `coverage.exclude gained '${e}': that hides code from coverage` });
  }
  for (const e of base.include) {
    if (!pr.include.includes(e))
      out.push({ file, message: `coverage.include lost '${e}': that hides code from coverage` });
  }
  return out;
}

const percent = z.number();
const thresholdsSchema = z.object({
  packages: z.record(z.string(), z.object({ lines: percent, branches: percent.optional() })),
  patch: z.object({ lines: percent }).optional(),
  sensitive: z
    .array(z.object({ name: z.string(), globs: z.array(z.string()), lines: percent, branches: percent.optional() }))
    .default([]),
});

export function checkThresholdsNotLowered(baseText: string | undefined, prText: string): Violation[] {
  if (baseText === undefined) return [];
  const base = thresholdsSchema.parse(JSON.parse(baseText));
  const pr = thresholdsSchema.parse(JSON.parse(prText));
  const file = THRESHOLDS_FILE;
  const out: Violation[] = [];
  const cmp = (label: string, before: number | undefined, after: number | undefined): void => {
    if (before === undefined) return;
    if (after === undefined) out.push({ file, message: `${label} was removed (it was ${before}%)` });
    else if (after < before) out.push({ file, message: `${label} was lowered from ${before}% to ${after}%` });
  };
  for (const [name, b] of Object.entries(base.packages)) {
    const p = pr.packages[name];
    if (p === undefined) {
      out.push({ file, message: `package '${name}' was removed from the thresholds` });
      continue;
    }
    cmp(`${name} lines`, b.lines, p.lines);
    cmp(`${name} branches`, b.branches, p.branches);
  }
  cmp('patch lines', base.patch?.lines, pr.patch?.lines);
  for (const b of base.sensitive) {
    const p = pr.sensitive.find((g) => g.name === b.name);
    if (p === undefined) {
      out.push({ file, message: `sensitive group '${b.name}' was removed from the thresholds` });
      continue;
    }
    cmp(`sensitive '${b.name}' lines`, b.lines, p.lines);
    cmp(`sensitive '${b.name}' branches`, b.branches, p.branches);
    for (const g of b.globs) {
      if (!p.globs.includes(g)) out.push({ file, message: `sensitive '${b.name}' no longer covers glob '${g}'` });
    }
  }
  return out;
}

export function protectedFilesTouched(paths: string[]): string[] {
  return paths.filter((p) => PROTECTED_EXACT.has(p) || PROTECTED_SCRIPT.test(p) || CONFIG_FILE.test(p));
}

export interface GuardInputs {
  diff: string;
  prBody: string;
  /** Base-branch file texts by repo-relative path; a missing key means "no previous version". */
  base: Record<string, string>;
  /** PR file texts by repo-relative path; a missing key means the file is absent in the PR. */
  pr: Record<string, string>;
}
export interface GuardResult {
  ok: boolean;
  output: string;
}

const escapeData = (s: string): string => s.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
const escapeProp = (s: string): string => escapeData(s).replace(/:/g, '%3A').replace(/,/g, '%2C');

export function runGuard(input: GuardInputs): GuardResult {
  const files = parseDiff(input.diff);
  const violations = checkIgnoreComments(files);
  for (const f of files) {
    const prText = input.pr[f.path];
    if (CONFIG_FILE.test(f.path) && prText !== undefined) {
      violations.push(...checkConfigWidening(f.path, input.base[f.path], prText));
    }
    if (f.path === THRESHOLDS_FILE) {
      const baseText = input.base[f.path];
      if (prText === undefined) {
        if (baseText !== undefined) violations.push({ file: f.path, message: 'the thresholds file was deleted' });
      } else violations.push(...checkThresholdsNotLowered(baseText, prText));
    }
  }

  const lines: string[] = [];
  const touched = protectedFilesTouched(files.map((f) => f.path));
  if (touched.length > 0) {
    lines.push(
      `::notice::PR touches protected coverage files, a human must review it: ${escapeData(touched.join(', '))}`,
    );
  }
  const justified = hasJustification(input.prBody);
  if (violations.length > 0 && justified) {
    lines.push(`::notice::${violations.length} coverage exception(s) accepted because the PR body has a justification`);
  }
  if (violations.length > 0 && !justified) {
    for (const v of violations) lines.push(`::error file=${escapeProp(v.file)}::${escapeData(v.message)}`);
    lines.push(
      `::error::${escapeData(
        `Fix the code, or explain why in the PR description under the heading "${EXCEPTIONS_HEADING}" ` +
          `(at least ${MIN_JUSTIFICATION_CHARS} characters of real explanation; "N/A" does not count)`,
      )}`,
    );
  }
  return { ok: violations.length === 0 || justified, output: lines.length > 0 ? `${lines.join('\n')}\n` : '' };
}

function readIfExists(path: string): string | undefined {
  return existsSync(path) ? readFileSync(path, 'utf8') : undefined;
}

function main(): void {
  const [diffPath, flag, baseDir] = process.argv.slice(2);
  if (diffPath === undefined || (flag !== undefined && (flag !== '--base-dir' || baseDir === undefined))) {
    throw new Error('usage: PR_BODY=... tsx scripts/coverage-guard.ts <pr.diff> [--base-dir <dir>]');
  }
  const diff = readFileSync(diffPath, 'utf8');
  const base: Record<string, string> = {};
  const pr: Record<string, string> = {};
  for (const f of parseDiff(diff)) {
    if (!CONFIG_FILE.test(f.path) && f.path !== THRESHOLDS_FILE) continue;
    const prText = readIfExists(f.path);
    if (prText !== undefined) pr[f.path] = prText;
    const baseText = baseDir === undefined ? undefined : readIfExists(join(baseDir, f.path));
    if (baseText !== undefined) base[f.path] = baseText;
  }
  const result = runGuard({ diff, prBody: process.env.PR_BODY ?? '', base, pr });
  process.stdout.write(result.output);
  if (!result.ok) process.exitCode = 1;
  else process.stdout.write('coverage guard: passed\n');
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) main();
