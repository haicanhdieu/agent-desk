#!/usr/bin/env node
// Helpers for the dev-plan skill: the worktree, the version marker on spec and plan
// files, the plan's task graph, and the sync of a merged spec/plan to its GitHub issue.
//
//   node dev-plan.mjs start <slug>
//       Create (or reopen) the worktree <root>-wt/plan-<slug> on branch spec/<slug>. A branch whose
//       PR already merged is started again from origin/main. Prints BRANCH, WORKTREE, MODE, OPEN_PR.
//   node dev-plan.mjs issue <n> <out file>
//       Save issue <n> (title and body, without dev-plan's own block) as the requirement file.
//       Prints ID=<slug> when the issue is already linked to a spec, else ID=none.
//   node dev-plan.mjs stamp <file> [--kind spec|plan] [--id <slug>] [--source issue#<n>|text|file] [--spec <spec file>]
//       Write or refresh the marker on line 1. --kind and --id are needed the first time
//       only; --spec the first time a plan is stamped. rev goes up only when the hash changes.
//   node dev-plan.mjs check <file>...
//       Print each file's state: clean | edited | unstamped | stale (plan older than its spec).
//       Exit 1 unless every file is clean.
//   node dev-plan.mjs graph <plan file> [--write]
//       Check the tasks' "**Depends on:**" lines (missing, unknown, cycle, two parallel tasks
//       touching one file) and print the waves. --write also (re)writes the "## Task graph" section.
//   node dev-plan.mjs sync --commit <sha> [--dry-run]
//       CI, after a merge to main: only when the merged PR has the `dev-plan` label, create or
//       update the linked issue for every stamped spec/plan the commit changed.
//   node dev-plan.mjs sync --files <spec or plan file>... [--dry-run]
//       The same by hand, for the named files, with no PR check.
//
// Run it from inside the repo (or the worktree). Plain Node, no dependencies. Text from
// tickets, specs and plans is untrusted: it reaches git and gh only as argv or a body file,
// never through a shell. Exit 2 = bad input, 1 = a check failed.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';

export const LABEL = 'dev-plan';
const LABEL_DESCRIPTION = 'Spec and plan written by the dev-plan skill (PR), or tracked by it (issue)';
const SPEC_DIR = 'docs/superpowers/specs';
const PLAN_DIR = 'docs/superpowers/plans';
const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+){0,4}$/;
const MARKER_RE = /^<!-- dev-plan: (.+?) -->$/;
const GRAPH_BEGIN = '<!-- dev-plan:graph:begin -->';
const GRAPH_END = '<!-- dev-plan:graph:end -->';

class UsageError extends Error {}
const fail = (message) => {
  throw new UsageError(message);
};

function run(command, commandArgs, options = {}) {
  return execFileSync(command, commandArgs, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...options }).trim();
}
const git = (gitArgs, options) => run('git', gitArgs, options);
const gh = (ghArgs) => run('gh', ghArgs);

// ---------------------------------------------------------------- marker and hash

/** Split a file into its marker fields (or null) and the text below the marker. */
export function splitMarker(text) {
  const newline = text.indexOf('\n');
  const first = (newline === -1 ? text : text.slice(0, newline)).replace(/\r$/, '');
  const match = first.match(MARKER_RE);
  if (!match) return { fields: null, body: text };
  const fields = {};
  for (const token of match[1].split(/\s+/)) {
    const eq = token.indexOf('=');
    if (eq > 0) fields[token.slice(0, eq)] = token.slice(eq + 1);
  }
  return { fields, body: newline === -1 ? '' : text.slice(newline + 1) };
}

/**
 * Hash of what the file says, so that only a real content change moves it: the marker line is
 * left out, line endings and trailing spaces are normalized, and a ticked checkbox counts as
 * unticked (dev-build ticks plan boxes as it builds; that is progress, not a new revision).
 */
export function contentHash(body) {
  const normalized = body
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.replace(/\s+$/, '').replace(/^(\s*[-*] )\[[xX]\]/, '$1[ ]'))
    .join('\n')
    .replace(/^\n+/, '')
    .replace(/\n+$/, '');
  return createHash('sha256').update(normalized).digest('hex').slice(0, 12);
}

function markerLine(fields) {
  const order = ['kind', 'id', 'rev', 'hash', 'source', 'spec', 'spec-hash'];
  const parts = order.filter((key) => fields[key] !== undefined).map((key) => `${key}=${fields[key]}`);
  return `<!-- dev-plan: ${parts.join(' ')} -->`;
}

function readStamped(file) {
  if (!existsSync(file)) fail(`no such file: ${file}`);
  const { fields, body } = splitMarker(readFileSync(file, 'utf8'));
  return { file, fields, body, hash: contentHash(body) };
}

function repoRoot(from = process.cwd()) {
  return git(['rev-parse', '--show-toplevel'], { cwd: from });
}

/** State of one stamped file. A plan is stale when its spec's content moved since the plan was stamped. */
export function stateOf(doc, root) {
  if (!doc.fields) return 'unstamped';
  if (doc.fields.hash !== doc.hash) return 'edited';
  if (doc.fields.kind === 'plan') {
    const specPath = join(root, doc.fields.spec ?? '');
    if (!doc.fields.spec || !existsSync(specPath)) return 'stale';
    if (readStamped(specPath).hash !== doc.fields['spec-hash']) return 'stale';
  }
  return 'clean';
}

function option(args, name) {
  const at = args.indexOf(name);
  if (at === -1) return undefined;
  const value = args[at + 1];
  if (value === undefined || value.startsWith('--')) fail(`${name} needs a value`);
  return value;
}

function positionals(args, valueOptions) {
  const out = [];
  for (let i = 0; i < args.length; i += 1) {
    if (valueOptions.includes(args[i])) i += 1;
    else if (!args[i].startsWith('--')) out.push(args[i]);
  }
  return out;
}

function stamp(args) {
  const [file] = positionals(args, ['--kind', '--id', '--source', '--spec']);
  if (!file) fail('stamp needs a file');
  const doc = readStamped(file);
  const root = repoRoot(dirname(resolve(file)));
  const old = doc.fields ?? {};
  const fields = {
    kind: option(args, '--kind') ?? old.kind,
    id: option(args, '--id') ?? old.id,
    source: option(args, '--source') ?? old.source,
  };
  if (fields.kind !== 'spec' && fields.kind !== 'plan') fail('--kind must be spec or plan (needed on the first stamp)');
  if (!fields.id || !SLUG_RE.test(fields.id)) fail('--id must be a slug: 1-5 lowercase words joined by "-"');
  if (fields.source !== undefined && !/^(issue#\d+|text|file)$/.test(fields.source)) {
    fail('--source must be issue#<n>, text or file');
  }
  if (fields.kind === 'plan') {
    const specArg = option(args, '--spec');
    const specRel = specArg ? relative(root, resolve(specArg)) : old.spec;
    if (!specRel) fail('a plan needs --spec <spec file> on its first stamp');
    if (/\s/.test(specRel)) fail(`the spec path must not contain spaces: ${specRel}`);
    const spec = readStamped(join(root, specRel));
    if (!spec.fields || spec.fields.kind !== 'spec') fail(`not a stamped spec: ${specRel}`);
    if (spec.fields.hash !== spec.hash) fail(`the spec was edited since its stamp; stamp it first: ${specRel}`);
    if (spec.fields.id !== fields.id) fail(`the spec's id is ${spec.fields.id}, not ${fields.id}`);
    fields.spec = specRel;
    fields['spec-hash'] = spec.hash;
    fields.source = undefined; // the spec carries the source
  }
  const dir = dirname(resolve(file));
  for (const name of readdirSync(dir).filter((entry) => entry.endsWith('.md'))) {
    if (resolve(dir, name) === resolve(file)) continue;
    const other = splitMarker(readFileSync(join(dir, name), 'utf8')).fields;
    if (other && other.kind === fields.kind && other.id === fields.id) {
      fail(
        `${name} already is the ${fields.kind} with id ${fields.id}; revise that file instead of adding a second one`,
      );
    }
  }
  const oldRev = Number(old.rev ?? 0);
  fields.rev = String(old.hash === doc.hash && oldRev > 0 ? oldRev : oldRev + 1);
  fields.hash = doc.hash;
  writeFileSync(file, `${markerLine(fields)}\n${doc.body}`);
  console.log(`STAMPED=${file}`);
  console.log(`REV=${fields.rev}`);
  console.log(`HASH=${fields.hash}`);
  console.log(`CHANGED=${old.hash === doc.hash ? 'no' : 'yes'}`);
}

function check(args) {
  if (args.length === 0) fail('check needs at least one file');
  let bad = 0;
  for (const file of args) {
    const doc = readStamped(file);
    const state = stateOf(doc, repoRoot(dirname(resolve(file))));
    if (state !== 'clean') bad += 1;
    const info = doc.fields
      ? ` kind=${doc.fields.kind} id=${doc.fields.id} rev=${doc.fields.rev} hash=${doc.hash}`
      : '';
    console.log(`${state}: ${file}${info}`);
  }
  console.log(
    bad === 0
      ? 'check: clean.'
      : `check: ${bad} file(s) not clean. Restamp an edited file; rewrite or restamp a stale plan.`,
  );
  if (bad > 0) process.exitCode = 1;
}

// ---------------------------------------------------------------- task graph

/** Parse `### Task N: title` blocks with their "**Depends on:**" line and the files they touch. */
export function parseTasks(text) {
  const tasks = [];
  let current = null;
  let inFence = false;
  for (const line of text.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    if (inFence) continue;
    const heading = line.match(/^### Task (\d+): (.+?)\s*$/);
    if (heading) {
      current = { id: Number(heading[1]), title: heading[2], dependsOn: null, files: new Set() };
      tasks.push(current);
      continue;
    }
    if (/^#{1,2} /.test(line)) current = null;
    if (!current) continue;
    const depends = line.match(/^\*\*Depends on:\*\*\s*(.*)$/);
    if (depends) {
      const value = depends[1].trim();
      const listed = [...value.matchAll(/Task (\d+)/g)].map((match) => Number(match[1]));
      // Anything left over ("Task 1, 2", "the API task") would be dropped silently, so it is an error.
      const leftover = value.replace(/Task \d+/g, '').replace(/\band\b|[,\s.]/g, '');
      if (/^none\.?$/i.test(value)) current.dependsOn = [];
      else current.dependsOn = listed.length > 0 && leftover === '' ? listed : null;
      continue;
    }
    if (/^\s*- (Create|Modify|Test|Delete):/.test(line)) {
      for (const match of line.matchAll(/`([^`]+)`/g)) {
        const path = match[1].replace(/:\d+(-\d+)?$/, '');
        if (path.includes('/') || path.includes('.')) current.files.add(path);
      }
    }
  }
  return tasks;
}

/** Errors, warnings and the wave of every task. Wave 1 depends on nothing; wave n on something in wave n-1. */
export function analyzeGraph(tasks) {
  const errors = [];
  const warnings = [];
  const byId = new Map();
  for (const task of tasks) {
    if (byId.has(task.id)) errors.push(`Task ${task.id} is defined twice`);
    byId.set(task.id, task);
  }
  if (tasks.length === 0) errors.push('no "### Task N: <title>" heading found');
  for (const task of tasks) {
    if (task.dependsOn === null) {
      errors.push(`Task ${task.id} has no "**Depends on:** none" or "**Depends on:** Task <n>, ..." line`);
      task.dependsOn = [];
    }
    for (const dep of task.dependsOn) {
      if (dep === task.id) errors.push(`Task ${task.id} depends on itself`);
      else if (!byId.has(dep)) errors.push(`Task ${task.id} depends on Task ${dep}, which does not exist`);
    }
    task.dependsOn = [...new Set(task.dependsOn)]
      .filter((dep) => dep !== task.id && byId.has(dep))
      .sort((a, b) => a - b);
    if (task.files.size === 0)
      warnings.push(`Task ${task.id} lists no files under "**Files:**", so overlap cannot be checked`);
  }

  // Everything a task needs, directly or not. A task found on its own path is a cycle.
  const ancestors = new Map();
  const visiting = new Set();
  let cyclic = false;
  const collect = (id) => {
    if (ancestors.has(id)) return ancestors.get(id);
    if (visiting.has(id)) {
      cyclic = true;
      return new Set();
    }
    visiting.add(id);
    const all = new Set();
    for (const dep of byId.get(id).dependsOn) {
      all.add(dep);
      for (const further of collect(dep)) all.add(further);
    }
    visiting.delete(id);
    ancestors.set(id, all);
    return all;
  };
  for (const task of tasks) collect(task.id);
  if (cyclic) {
    errors.push('the dependencies form a cycle');
    return { errors, warnings, waves: [] };
  }

  const wave = new Map();
  const waveOf = (id) => {
    if (!wave.has(id)) wave.set(id, 1 + Math.max(0, ...byId.get(id).dependsOn.map(waveOf)));
    return wave.get(id);
  };
  for (const task of tasks) task.wave = waveOf(task.id);

  // Two tasks with no path between them may be built at the same time, so they must not share a file.
  for (let i = 0; i < tasks.length; i += 1) {
    for (let j = i + 1; j < tasks.length; j += 1) {
      const a = tasks[i];
      const b = tasks[j];
      if (ancestors.get(a.id).has(b.id) || ancestors.get(b.id).has(a.id)) continue;
      const shared = [...a.files].filter((file) => b.files.has(file));
      if (shared.length > 0) {
        errors.push(
          `Task ${a.id} and Task ${b.id} can run in parallel but both touch ${shared.join(', ')}: ` +
            'make one depend on the other, or move that change into one task',
        );
      }
    }
  }

  const waves = [];
  for (const task of tasks) (waves[task.wave - 1] ??= []).push(task.id);
  if (tasks.length > 2 && waves.every((ids) => ids.length === 1)) {
    warnings.push(
      'every task waits for the one before it: nothing can be built in parallel. Check each dependency is real',
    );
  }
  return { errors, warnings, waves };
}

export function renderGraph(tasks) {
  const label = (task) => `${task.id}: ${task.title.replace(/["`[\]{}|<>]/g, '')}`;
  const lines = [
    GRAPH_BEGIN,
    '## Task graph',
    '',
    "Generated by `dev-plan.mjs graph --write` from each task's **Depends on:** line. Do not edit it by hand.",
    'Tasks in the same wave touch no common file and can be built in parallel; a task starts when everything it depends on is merged.',
    '',
    '| Wave | Task | Depends on |',
    '| ---- | ---- | ---------- |',
    ...tasks
      .slice()
      .sort((a, b) => a.wave - b.wave || a.id - b.id)
      .map(
        (task) =>
          `| ${task.wave} | Task ${label(task)} | ${task.dependsOn.map((dep) => `Task ${dep}`).join(', ') || 'none'} |`,
      ),
    '',
    '```mermaid',
    'graph LR',
    ...tasks.map((task) => `  T${task.id}["${label(task)}"]`),
    ...tasks.flatMap((task) => task.dependsOn.map((dep) => `  T${dep} --> T${task.id}`)),
    '```',
    GRAPH_END,
  ];
  return lines.join('\n');
}

function graph(args) {
  const [file] = positionals(args, []);
  if (!file) fail('graph needs a plan file');
  if (!existsSync(file)) fail(`no such file: ${file}`);
  const text = readFileSync(file, 'utf8');
  const tasks = parseTasks(text);
  const { errors, warnings, waves } = analyzeGraph(tasks);
  for (const warning of warnings) console.log(`warning: ${warning}`);
  for (const error of errors) console.log(`error: ${error}`);
  if (errors.length > 0) {
    console.log(`graph: ${errors.length} error(s).`);
    process.exitCode = 1;
    return;
  }
  waves.forEach((ids, index) => console.log(`WAVE ${index + 1}: ${ids.map((id) => `Task ${id}`).join(', ')}`));
  console.log(`TASKS=${tasks.length} WAVES=${waves.length} WIDEST=${Math.max(...waves.map((ids) => ids.length))}`);
  if (args.includes('--write')) {
    const section = renderGraph(tasks);
    const begin = text.indexOf(GRAPH_BEGIN);
    const end = text.indexOf(GRAPH_END);
    let next;
    if (begin !== -1 && end > begin) {
      next = text.slice(0, begin) + section + text.slice(end + GRAPH_END.length);
    } else {
      const firstTask = text.search(/^### Task \d+: /m);
      next = `${text.slice(0, firstTask)}${section}\n\n${text.slice(firstTask)}`;
    }
    if (next !== text) writeFileSync(file, next);
    console.log(`GRAPH_WRITTEN=${next !== text ? 'yes' : 'unchanged'}`);
  }
  console.log('graph: clean.');
}

// ---------------------------------------------------------------- worktree

function start(args) {
  const [slug] = args;
  if (!slug || !SLUG_RE.test(slug))
    fail('start needs a slug: 1-5 lowercase words joined by "-" (letters and digits only)');
  // The main checkout, even when called from a worktree.
  const root = dirname(resolve(git(['rev-parse', '--path-format=absolute', '--git-common-dir'])));
  const branch = `spec/${slug}`;
  const worktree = `${root}-wt/plan-${slug}`;
  let mode = 'resume';
  git(['-C', root, 'fetch', '--quiet', 'origin', 'main']);
  const hasLocal = () => git(['-C', root, 'branch', '--list', branch]) !== '';
  if (existsSync(worktree)) {
    const current = git(['-C', worktree, 'rev-parse', '--abbrev-ref', 'HEAD']);
    if (current !== branch) fail(`${worktree} exists but is on ${current}, not ${branch}`);
  }
  // An earlier run of this slug whose PR merged: its branch is finished. Start again from main,
  // unless the branch moved after the merge or the worktree holds uncommitted work.
  let pulls;
  try {
    pulls = JSON.parse(gh(['pr', 'list', '--head', branch, '--state', 'all', '--json', 'number,state,headRefOid']));
  } catch {
    pulls = []; // no gh, or not signed in: treat the branch as live
  }
  const open = pulls.find((pull) => pull.state === 'OPEN');
  const merged = pulls.find((pull) => pull.state === 'MERGED');
  if (hasLocal() && merged && !open) {
    const tip = git(['-C', root, 'rev-parse', branch]);
    if (tip !== merged.headRefOid) {
      fail(`${branch} has commits made after its PR #${merged.number} merged; move or delete the branch, then rerun`);
    }
    if (existsSync(worktree)) {
      if (git(['-C', worktree, 'status', '--porcelain']) !== '') {
        fail(
          `${worktree} has uncommitted changes, but PR #${merged.number} of ${branch} already merged; clean it up, then rerun`,
        );
      }
      git(['-C', root, 'worktree', 'remove', worktree]);
    }
    git(['-C', root, 'branch', '-D', branch]);
    console.log(`PREVIOUS_PR=${merged.number}`);
  }
  if (!existsSync(worktree)) {
    const onOrigin = git(['-C', root, 'ls-remote', '--heads', 'origin', branch]) !== '';
    const local = hasLocal();
    if (onOrigin && !local) {
      git(['-C', root, 'fetch', '--quiet', 'origin', `${branch}:${branch}`]);
      git(['-C', root, 'worktree', 'add', worktree, branch]);
    } else if (local) {
      git(['-C', root, 'worktree', 'add', worktree, branch]);
    } else {
      mode = 'new';
      git(['-C', root, 'worktree', 'add', '-b', branch, worktree, 'origin/main']);
    }
  }
  console.log(`BRANCH=${branch}`);
  console.log(`WORKTREE=${worktree}`);
  console.log(`MODE=${mode}`);
  console.log(`OPEN_PR=${open ? open.number : 'none'}`);
}

/** Save an issue as the requirement file, without the block dev-plan itself keeps in the body. */
function issue(args) {
  const [number, out] = args;
  if (!/^\d+$/.test(number ?? '') || !out) fail('issue needs an issue number and an output file');
  const data = JSON.parse(gh(['issue', 'view', number, '--json', 'title,body']));
  const body = data.body ?? '';
  const id = body.match(/<!-- dev-plan:id=([a-z0-9-]+) -->/)?.[1];
  const own = /<!-- dev-plan:begin [^>]*-->[\s\S]*?<!-- dev-plan:end -->/g;
  writeFileSync(out, `# ${data.title}\n\n${body.replace(own, '').trim()}\n`);
  console.log(`REQUIREMENT=${out}`);
  console.log(`ID=${id ?? 'none'}`);
}

// ---------------------------------------------------------------- sync to the issue

const idMarker = (id) => `<!-- dev-plan:id=${id} -->`;

/** Every stamped spec and plan in the repo, by id. */
function indexStamped(root) {
  const byId = new Map();
  for (const [dir, kind] of [
    [SPEC_DIR, 'spec'],
    [PLAN_DIR, 'plan'],
  ]) {
    const abs = join(root, dir);
    if (!existsSync(abs)) continue;
    for (const name of readdirSync(abs)
      .filter((entry) => entry.endsWith('.md'))
      .sort()) {
      const doc = readStamped(join(abs, name));
      if (!doc.fields || doc.fields.kind !== kind || !SLUG_RE.test(doc.fields.id ?? '')) continue;
      const entry = byId.get(doc.fields.id) ?? {};
      if (entry[kind]) fail(`two ${kind} files carry the id ${doc.fields.id}: ${entry[kind].path} and ${dir}/${name}`);
      entry[kind] = { ...doc, path: `${dir}/${name}` };
      byId.set(doc.fields.id, entry);
    }
  }
  return byId;
}

function firstHeading(body) {
  const match = body.match(/^# (.+?)\s*$/m);
  return match ? match[1] : null;
}

/** The block dev-plan owns inside the issue body. Its first line carries the versions, so a re-run can compare. */
export function renderBlock({ id, spec, plan, repo, sha }) {
  const version = (doc) => (doc ? `${doc.fields.rev}/${doc.hash}` : 'none');
  const link = (doc) =>
    `[\`${doc.path}\`](https://github.com/${repo}/blob/${sha}/${doc.path}) (rev ${doc.fields.rev}, \`${doc.hash}\`)`;
  const lines = [
    `<!-- dev-plan:begin id=${id} spec=${version(spec)} plan=${version(plan)} -->`,
    idMarker(id),
    '## Spec and plan',
    '',
    '_Kept up to date by `dev-plan` when a spec or plan PR merges. Edit the files, not this block._',
    '',
  ];
  const goal = plan?.body.match(/^\*\*Goal:\*\*\s*(.+)$/m)?.[1];
  if (goal) lines.push(`**Goal:** ${goal}`, '');
  if (spec) lines.push(`- Spec: ${link(spec)}`);
  if (plan) lines.push(`- Plan: ${link(plan)}`);
  if (plan) {
    const tasks = parseTasks(plan.body);
    const { errors } = analyzeGraph(tasks);
    if (tasks.length > 0 && errors.length === 0) {
      lines.push('', '| Wave | Task | Depends on |', '| ---- | ---- | ---------- |');
      for (const task of tasks.slice().sort((a, b) => a.wave - b.wave || a.id - b.id)) {
        const title = task.title.replace(/\|/g, '\\|');
        lines.push(
          `| ${task.wave} | Task ${task.id}: ${title} | ${task.dependsOn.map((dep) => `Task ${dep}`).join(', ') || 'none'} |`,
        );
      }
    }
  }
  lines.push('<!-- dev-plan:end -->');
  return lines.join('\n');
}

/**
 * What to do with the issue body: { action: 'unchanged' | 'newer' } (write nothing) or
 * { action: 'updated', body }. Only this id's block is replaced, so an issue can hold the blocks
 * of several ids, and text outside them is kept. A block holding a higher rev than the files
 * (an old merge's workflow re-run) is left alone.
 */
export function mergeBody(oldBody, block, id) {
  const blockRe = new RegExp(`<!-- dev-plan:begin id=${id} [^>]*-->[\\s\\S]*?<!-- dev-plan:end -->`);
  const existing = oldBody.match(blockRe);
  const firstLine = (text) => text.split('\n', 1)[0];
  if (!existing) {
    return { action: 'updated', body: oldBody.trim() === '' ? block : `${oldBody.replace(/\s+$/, '')}\n\n${block}` };
  }
  if (firstLine(existing[0]) === firstLine(block)) return { action: 'unchanged' };
  const revs = (text) =>
    ['spec', 'plan'].map((kind) => Number(firstLine(text).match(new RegExp(` ${kind}=(\\d+)/`))?.[1] ?? 0));
  const [oldSpec, oldPlan] = revs(existing[0]);
  const [newSpec, newPlan] = revs(block);
  if (oldSpec > newSpec || oldPlan > newPlan) return { action: 'newer' };
  return { action: 'updated', body: oldBody.replace(blockRe, () => block) };
}

function sync(args) {
  const dryRun = args.includes('--dry-run');
  const commit = option(args, '--commit');
  const filesAt = args.indexOf('--files');
  const files = filesAt === -1 ? [] : args.slice(filesAt + 1).filter((arg) => !arg.startsWith('--'));
  if (!commit === (files.length === 0)) fail('sync needs either --commit <sha> or --files <file>...');
  const root = repoRoot();
  const repo =
    process.env.GITHUB_REPOSITORY || gh(['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner']);
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) fail(`unexpected repository name: ${repo}`);

  let sha;
  let pr = null;
  let changed;
  if (commit) {
    if (!/^[0-9a-f]{7,40}$/.test(commit)) fail('--commit must be a commit sha');
    sha = git(['-C', root, 'rev-parse', commit]);
    // The gate that tells a dev-plan PR from every other PR: the label the skill put on it.
    let pulls;
    try {
      pulls = JSON.parse(gh(['api', `repos/${repo}/commits/${sha}/pulls`]));
    } catch {
      return console.log(`sync: skipped. GitHub knows no pull request for commit ${sha.slice(0, 12)}.`);
    }
    pr =
      pulls.find((pull) => pull.merged_at && pull.merge_commit_sha === sha) ??
      pulls.find((pull) => pull.merged_at) ??
      null;
    if (!pr) return console.log(`sync: skipped. Commit ${sha.slice(0, 12)} did not come from a merged PR.`);
    if (!pr.labels.some((label) => label.name === LABEL)) {
      return console.log(`sync: skipped. PR #${pr.number} has no \`${LABEL}\` label, so it is not a dev-plan PR.`);
    }
    changed = git(['-C', root, 'diff', '--name-only', '--no-renames', `${sha}^1`, sha]).split('\n');
  } else {
    // Links must point at a commit GitHub has: main as last fetched, not a local branch tip.
    try {
      sha = git(['-C', root, 'rev-parse', '--verify', '--quiet', 'origin/main']);
    } catch {
      sha = git(['-C', root, 'rev-parse', 'HEAD']);
    }
    changed = files.map((file) => relative(root, resolve(file)));
  }

  const byId = indexStamped(root);
  const ids = new Set();
  for (const path of changed) {
    if (!path.startsWith(`${SPEC_DIR}/`) && !path.startsWith(`${PLAN_DIR}/`)) continue;
    if (!existsSync(join(root, path))) continue;
    const { fields } = readStamped(join(root, path));
    if (fields && byId.has(fields.id)) ids.add(fields.id);
    else console.log(`sync: ${path} has no dev-plan marker; left alone.`);
  }
  if (ids.size === 0) return console.log('sync: nothing to do. No stamped spec or plan in this change.');

  const scratch = mkdtempSync(join(tmpdir(), 'dev-plan-sync-'));
  const bodyFile = (name, text) => {
    const path = join(scratch, name);
    writeFileSync(path, text);
    return path;
  };
  if (!dryRun)
    gh(['label', 'create', LABEL, '--repo', repo, '--color', '1d76db', '--description', LABEL_DESCRIPTION, '--force']);

  const results = [];
  for (const id of [...ids].sort()) {
    const { spec, plan } = byId.get(id);
    for (const doc of [spec, plan]) {
      if (doc && doc.fields.hash !== doc.hash)
        console.log(`warning: ${doc.path} was edited after its stamp; syncing what is on disk.`);
    }
    const block = renderBlock({ id, spec, plan, repo, sha });
    const sourceIssue = spec?.fields.source?.match(/^issue#(\d+)$/)?.[1];
    let issue;
    if (sourceIssue) {
      issue = JSON.parse(gh(['issue', 'view', sourceIssue, '--repo', repo, '--json', 'number,body,url,state']));
    } else {
      let labelled;
      try {
        labelled = JSON.parse(
          gh([
            'issue',
            'list',
            '--repo',
            repo,
            '--label',
            LABEL,
            '--state',
            'all',
            '--limit',
            '1000',
            '--json',
            'number,body,url,state',
          ]),
        );
      } catch {
        labelled = []; // the label does not exist yet
      }
      issue = labelled.find((candidate) => candidate.body.includes(idMarker(id))) ?? null;
    }

    let action;
    let url;
    if (!issue) {
      action = 'created';
      const title = (firstHeading(spec?.body ?? plan?.body ?? '') ?? id).slice(0, 200);
      url = dryRun
        ? '(dry run)'
        : gh([
            'issue',
            'create',
            '--repo',
            repo,
            '--title',
            title,
            '--body-file',
            bodyFile(`${id}.md`, block),
            '--label',
            LABEL,
            // So dev-build's Triage reads the new ticket as a feature without asking.
            '--label',
            'enhancement',
          ]);
    } else {
      url = issue.url;
      const merged = mergeBody(issue.body ?? '', block, id);
      action = merged.action;
      const body = merged.body;
      if (action === 'newer')
        console.log(`sync: issue #${issue.number} already holds a newer rev of ${id}; left alone.`);
      if (action === 'updated' && !dryRun) {
        gh([
          'issue',
          'edit',
          String(issue.number),
          '--repo',
          repo,
          '--body-file',
          bodyFile(`${id}.md`, body),
          '--add-label',
          LABEL,
        ]);
      }
      if (issue.state === 'CLOSED')
        console.log(`warning: issue #${issue.number} is closed; its block was still ${action}.`);
    }
    console.log(`sync: ${id} -> ${url} ${action}${dryRun ? ' (dry run, nothing written)' : ''}`);
    if (dryRun && (action === 'created' || action === 'updated')) console.log(block);
    results.push({ id, url, action });
  }

  const news = results.filter((result) => result.action === 'created' || result.action === 'updated');
  if (pr && news.length > 0 && !dryRun) {
    const text = [
      '**dev-plan:** the spec and plan from this PR are linked on:',
      '',
      ...news.map((result) => `- ${result.url} (${result.action})`),
    ];
    gh(['pr', 'comment', String(pr.number), '--repo', repo, '--body-file', bodyFile('comment.md', text.join('\n'))]);
  }
}

// ---------------------------------------------------------------- entry

const COMMANDS = { start, issue, stamp, check, graph, sync };

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  const [command, ...rest] = process.argv.slice(2);
  try {
    if (!COMMANDS[command])
      fail(`usage: dev-plan.mjs <${Object.keys(COMMANDS).join('|')}> ... (see the header of this file)`);
    COMMANDS[command](rest);
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    console.error(`dev-plan: ${error.message}`);
    process.exit(2);
  }
}
