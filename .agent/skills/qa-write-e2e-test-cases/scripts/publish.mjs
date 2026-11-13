#!/usr/bin/env node
// Creates or updates the GitHub issues for a scope. Idempotent: issues are found
// by a hidden marker in their body, so a re-run edits them instead of duplicating.
//
//   node publish.mjs existing <slug>          print the rules already published for a scope (JSON)
//   node publish.mjs <workdir> [--dry-run]    create/update parent + one sub-issue per rule
//
// Needs an authenticated `gh` in the target repository. All text goes to gh as
// argv or a body file, never through a shell.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { LABEL_SCOPE, LABEL_RULE, scopeMarker, readJson } from './lib.mjs';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const positional = args.filter((arg) => !arg.startsWith('--'));

function gh(ghArgs) {
  return execFileSync('gh', ghArgs, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim();
}

function listIssues(label) {
  try {
    return JSON.parse(
      gh([
        'issue',
        'list',
        '--label',
        label,
        '--state',
        'all',
        '--limit',
        '1000',
        '--json',
        'number,title,body,state,url',
      ]),
    );
  } catch {
    return []; // label does not exist yet
  }
}

function findExisting(slug) {
  const parent = listIssues(LABEL_SCOPE).find((issue) => issue.body.includes(scopeMarker(slug)));
  const pattern = new RegExp(`<!-- qa-e2e:rule=${slug}/(BR-\\d+) -->`);
  const rules = new Map();
  for (const issue of listIssues(LABEL_RULE)) {
    const match = issue.body.match(pattern);
    if (match) rules.set(match[1], issue);
  }
  return { parent, rules };
}

// ------------------------------------------------------------------ existing

if (positional[0] === 'existing') {
  const slug = positional[1];
  if (!slug) {
    console.error('usage: node publish.mjs existing <slug>');
    process.exit(2);
  }
  const { parent, rules } = findExisting(slug);
  const statement = (body) => body.match(/## Rule\s+> (.+)/)?.[1] ?? null;
  console.log(
    JSON.stringify(
      {
        slug,
        parent: parent ? { number: parent.number, state: parent.state, url: parent.url } : null,
        rules: [...rules.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([id, issue]) => ({
            id,
            number: issue.number,
            state: issue.state,
            title: issue.title,
            statement: statement(issue.body),
            cases: [...issue.body.matchAll(/\*\*(TC-BR\d+-\d+)\*\* (?:`[^`]+` )*(.+)$/gm)].map((match) => ({
              id: match[1],
              title: match[2].trim(),
            })),
          })),
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

// ------------------------------------------------------------------- publish

const workdir = positional[0];
if (!workdir) {
  console.error('usage: node publish.mjs <workdir> [--dry-run] | existing <slug>');
  process.exit(2);
}

const outDir = join(workdir, 'out');
const manifest = readJson(join(outDir, 'manifest.json'));
const repo = gh(['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner']);
const existing = findExisting(manifest.slug);
const log = [];
const warnings = [];

function ensureLabel(name, color, description) {
  if (dryRun) return;
  gh(['label', 'create', name, '--color', color, '--description', description, '--force']);
}

function writeBody(name, body) {
  const path = join(outDir, `${name}.publish.md`);
  writeFileSync(path, body);
  return path;
}

function createIssue(title, bodyPath, label) {
  const url = gh(['issue', 'create', '--title', title, '--body-file', bodyPath, '--label', label]);
  return { number: Number(url.split('/').pop()), url };
}

function editIssue(number, title, bodyPath) {
  gh(['issue', 'edit', String(number), '--title', title, '--body-file', bodyPath]);
}

// Keep the boxes people already ticked.
function keepTicks(newBody, oldBody) {
  const ticked = new Set([...oldBody.matchAll(/- \[[xX]\] \*\*(TC-BR\d+-\d+)\*\*/g)].map((match) => match[1]));
  return newBody.replace(/- \[ \] \*\*(TC-BR\d+-\d+)\*\*/g, (line, id) => (ticked.has(id) ? `- [x] **${id}**` : line));
}

function keepTickedQuestions(newBody, oldBody) {
  const ticked = new Set([...oldBody.matchAll(/^- \[[xX]\] (.+)$/gm)].map((match) => match[1].trim()));
  return newBody.replace(/^- \[ \] (.+)$/gm, (line, text) => (ticked.has(text.trim()) ? `- [x] ${text}` : line));
}

function linkSubIssue(parentNumber, childNumber) {
  try {
    const id = gh(['api', `repos/${repo}/issues/${childNumber}`, '--jq', '.id']);
    gh(['api', '-X', 'POST', `repos/${repo}/issues/${parentNumber}/sub_issues`, '-F', `sub_issue_id=${id}`]);
  } catch (error) {
    const text = String(error.stderr ?? error.message);
    if (/already|duplicate|only have one parent/i.test(text)) return;
    warnings.push(`could not link #${childNumber} as a sub-issue of #${parentNumber}: ${text.split('\n')[0]}`);
  }
}

ensureLabel(LABEL_SCOPE, '5319e7', 'E2E test-case scope: parent of one issue per business rule');
ensureLabel(LABEL_RULE, 'c5def5', 'E2E test cases for one business rule');

// 1. Parent first (rule issues link back to it). Tokens are filled in at the end.
const parentTemplate = readFileSync(join(outDir, manifest.parent.bodyFile), 'utf8');
let parent = existing.parent;
if (!parent) {
  if (dryRun) {
    parent = { number: 0, url: '(new)' };
    log.push(`create parent: ${manifest.parent.title}`);
  } else {
    parent = createIssue(manifest.parent.title, writeBody('parent', parentTemplate), LABEL_SCOPE);
    log.push(`created parent #${parent.number}`);
  }
}
const parentRef = parent.number ? `#${parent.number}` : '(new parent)';

// 2. One sub-issue per rule.
const numbers = new Map();
for (const rule of manifest.rules) {
  const body = readFileSync(join(outDir, rule.bodyFile), 'utf8').replaceAll('{{issue:parent}}', parentRef);
  const current = existing.rules.get(rule.id);
  if (current) {
    numbers.set(rule.id, current.number);
    const merged = keepTickedQuestions(keepTicks(body, current.body), current.body);
    if (dryRun) log.push(`update #${current.number} (${current.state.toLowerCase()}): ${rule.title}`);
    else {
      editIssue(current.number, rule.title, writeBody(rule.id, merged));
      linkSubIssue(parent.number, current.number);
      log.push(`updated #${current.number}: ${rule.title}`);
    }
    if (current.state === 'CLOSED' && /- \[ \] \*\*TC-BR/.test(merged))
      warnings.push(
        `#${current.number} (${rule.id}) is closed but now has unticked cases; reopen it if they are new work`,
      );
  } else if (dryRun) {
    log.push(`create rule issue: ${rule.title}`);
  } else {
    const created = createIssue(rule.title, writeBody(rule.id, body), LABEL_RULE);
    numbers.set(rule.id, created.number);
    linkSubIssue(parent.number, created.number);
    log.push(`created #${created.number}: ${rule.title}`);
  }
}

// 3. Rules published by an earlier run that this run no longer produces.
const produced = new Set(manifest.rules.map((rule) => rule.id));
for (const [id, issue] of existing.rules)
  if (!produced.has(id))
    warnings.push(
      `#${issue.number} (${id}) was published earlier but is not in this run; review and close it if the rule is gone`,
    );

// 4. Fill the issue numbers into the parent.
let parentBody = parentTemplate;
for (const rule of manifest.rules)
  parentBody = parentBody.replaceAll(
    `{{issue:${rule.id}}}`,
    numbers.has(rule.id) ? `#${numbers.get(rule.id)}` : '(new)',
  );
if (existing.parent) parentBody = keepTickedQuestions(parentBody, existing.parent.body);
if (dryRun) {
  writeBody('parent', parentBody);
  if (existing.parent) log.push(`update parent #${parent.number}`);
} else {
  editIssue(parent.number, manifest.parent.title, writeBody('parent', parentBody));
  if (existing.parent) log.push(`updated parent #${parent.number}`);
}

console.log(
  JSON.stringify(
    {
      dryRun,
      repo,
      parent: { number: parent.number || null, url: parent.url },
      rules: manifest.rules.map((rule) => ({ id: rule.id, number: numbers.get(rule.id) ?? null })),
      actions: log,
      warnings,
    },
    null,
    2,
  ),
);
