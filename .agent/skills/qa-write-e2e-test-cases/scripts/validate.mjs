#!/usr/bin/env node
// Mechanical checks on the drafts. Exit 0 = clean, 1 = errors (printed one per line).
//
//   node validate.mjs <workdir> rules          scope.json requirements and rules (after extraction / reconcile)
//   node validate.mjs <workdir> clusters       + scope.json clusters (after clustering)
//   node validate.mjs <workdir> cluster CL-02  + the rules/<BR>.json of one cluster (for its writer)
//   node validate.mjs <workdir> cases          + every rules/<BR>.json, duplicates across clusters, reviews
//
// Run from the repo root: source paths in scope.json resolve against the current
// directory first, then against <workdir>.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  CATEGORIES,
  TECHNIQUES,
  CASE_TYPES,
  PRIORITIES,
  STATUSES,
  RULE_FINDINGS,
  CASE_FINDINGS,
  RESOLUTIONS,
  CLUSTER_MIN_RULES,
  CLUSTER_MAX_RULES,
  casePrefix,
  readJson,
  isNonEmptyString,
  isStringArray,
} from './lib.mjs';

const [workdir, stage = 'cases', onlyCluster] = process.argv.slice(2);
if (!workdir || !['rules', 'clusters', 'cluster', 'cases'].includes(stage) || (stage === 'cluster' && !onlyCluster)) {
  console.error('usage: node validate.mjs <workdir> rules|clusters|cluster CL-xx|cases');
  process.exit(2);
}

const errors = [];
const err = (where, message) => errors.push(`${where}: ${message}`);

const VAGUE =
  /\b(works?|behaves?|functions?|displays?|shows?|renders?|loads?) (correctly|properly|fine|as expected|as intended)\b|\bas expected\b|\bshould work\b|\band so on\b|\betc\b/i;

// Formatting-insensitive text, so a quote copied from rendered markdown still matches its source.
const normalize = (text) =>
  text
    .toLowerCase()
    .replace(/<[^>]+>/g, ' ')
    .replace(/[*_`#>|\\~[\]()"'“”‘’-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

function load(path, where) {
  if (!existsSync(path)) {
    err(where, `file not found: ${path}`);
    return null;
  }
  try {
    return readJson(path);
  } catch (error) {
    err(where, `invalid JSON: ${error.message}`);
    return null;
  }
}

function uniqueIds(items, pattern, where, example) {
  const seen = new Set();
  for (const [index, item] of items.entries()) {
    const id = item?.id;
    if (!isNonEmptyString(id) || !pattern.test(id)) {
      err(`${where}[${index}]`, `id must look like ${example}, got ${JSON.stringify(id)}`);
      continue;
    }
    if (seen.has(id)) err(`${where}[${index}]`, `duplicate id ${id}`);
    seen.add(id);
  }
  return seen;
}

// ---------------------------------------------------------------- scope.json

function validateScope(scope) {
  if (!isNonEmptyString(scope.slug) || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(scope.slug))
    err('scope.slug', 'must be kebab-case');
  if (!isNonEmptyString(scope.title)) err('scope.title', 'required');

  const env = scope.env ?? {};
  for (const key of ['name', 'targetDir', 'runCommand'])
    if (!isNonEmptyString(env[key])) err(`scope.env.${key}`, 'required');

  // Sources: every path must exist; their text is the corpus quotes are checked against.
  const corpus = [];
  if (!Array.isArray(scope.sources) || scope.sources.length === 0) err('scope.sources', 'at least one source');
  for (const [index, source] of (scope.sources ?? []).entries()) {
    if (!isNonEmptyString(source?.path)) {
      err(`scope.sources[${index}].path`, 'required');
      continue;
    }
    const path = [source.path, join(workdir, source.path)].find((candidate) => existsSync(candidate));
    if (!path) {
      err(`scope.sources[${index}].path`, `not found: ${source.path}`);
      continue;
    }
    if (/(^|\/)(apps|packages)\/[^/]+\/src\//.test(source.path))
      err(`scope.sources[${index}].path`, 'implementation code is not a requirement source');
    corpus.push(normalize(readFileSync(path, 'utf8')));
  }

  const requirements = Array.isArray(scope.requirements) ? scope.requirements : [];
  if (requirements.length === 0) err('scope.requirements', 'at least one requirement');
  const reqIds = uniqueIds(requirements, /^R\d+$/, 'scope.requirements', 'R1');
  for (const [index, req] of requirements.entries()) {
    const where = `scope.requirements[${index}] (${req?.id})`;
    if (!isNonEmptyString(req?.text)) {
      err(where, 'text required');
      continue;
    }
    if (!isNonEmptyString(req.source)) err(where, 'source required (file and section)');
    if (req.verbatim === false) {
      if (!isNonEmptyString(req.note)) err(where, 'verbatim:false needs a note saying what it was derived from');
    } else if (corpus.length > 0 && !corpus.some((text) => text.includes(normalize(req.text)))) {
      err(where, 'text is not a verbatim quote from any source (copy it exactly, or set verbatim:false with a note)');
    }
  }

  const rules = Array.isArray(scope.rules) ? scope.rules : [];
  if (rules.length === 0) err('scope.rules', 'at least one rule');
  const ruleIds = uniqueIds(rules, /^BR-\d{2,}$/, 'scope.rules', 'BR-01');
  const mapped = new Set();
  const statements = new Map();
  for (const [index, rule] of rules.entries()) {
    const where = `scope.rules[${index}] (${rule?.id})`;
    if (!isNonEmptyString(rule?.title)) err(where, 'title required');
    else if (rule.title.length > 80) err(where, 'title longer than 80 characters');
    if (!isNonEmptyString(rule?.statement)) err(where, 'statement required');
    else {
      if (!/^When /.test(rule.statement)) err(where, 'statement must start with "When "');
      if (!/, /.test(rule.statement)) err(where, 'statement must be "When <condition>, <actor> <outcome>"');
      if (VAGUE.test(rule.statement)) err(where, 'statement is vague; name the observable outcome');
      const key = normalize(rule.statement);
      if (statements.has(key)) err(where, `same statement as ${statements.get(key)}`);
      statements.set(key, rule.id);
    }
    if (!CATEGORIES.includes(rule?.category)) err(where, `category must be one of: ${CATEGORIES.join(', ')}`);
    if (!isStringArray(rule?.requirements)) err(where, 'requirements must list at least one R id');
    for (const id of rule?.requirements ?? []) {
      if (!reqIds.has(id)) err(where, `unknown requirement ${id}`);
      mapped.add(id);
    }
  }

  const excluded = Array.isArray(scope.excluded) ? scope.excluded : [];
  const excludedIds = new Set();
  for (const [index, item] of excluded.entries()) {
    const where = `scope.excluded[${index}]`;
    if (!reqIds.has(item?.requirement)) err(where, `unknown requirement ${item?.requirement}`);
    if (!isNonEmptyString(item?.reason)) err(where, 'reason required');
    if (mapped.has(item?.requirement)) err(where, `${item.requirement} is both excluded and mapped to a rule`);
    excludedIds.add(item?.requirement);
  }
  for (const id of reqIds)
    if (!mapped.has(id) && !excludedIds.has(id))
      err('scope.requirements', `${id} maps to no rule and is not in excluded`);

  const questions = Array.isArray(scope.openQuestions) ? scope.openQuestions : [];
  uniqueIds(questions, /^Q\d+$/, 'scope.openQuestions', 'Q1');
  for (const [index, question] of questions.entries()) {
    const where = `scope.openQuestions[${index}]`;
    if (!isNonEmptyString(question?.question)) err(where, 'question required');
    const about = question?.about;
    if (about !== 'scope' && !reqIds.has(about) && !ruleIds.has(about))
      err(where, 'about must be "scope", a requirement id or a rule id');
  }

  return { ruleIds };
}

// ------------------------------------------------------- scope.json clusters

function validateClusters(scope, ruleIds) {
  const clusters = Array.isArray(scope.clusters) ? scope.clusters : [];
  if (clusters.length === 0) {
    err('scope.clusters', 'at least one cluster');
    return new Map();
  }
  uniqueIds(clusters, /^CL-\d{2,}$/, 'scope.clusters', 'CL-01');
  const owner = new Map();
  const byId = new Map();
  for (const [index, cluster] of clusters.entries()) {
    const where = `scope.clusters[${index}] (${cluster?.id})`;
    if (!isNonEmptyString(cluster?.title)) err(where, 'title required');
    else if (cluster.title.length > 80) err(where, 'title longer than 80 characters');
    if (!isNonEmptyString(cluster?.summary)) err(where, 'summary required (one sentence: the screen or flow)');
    if (!isStringArray(cluster?.rules)) {
      err(where, 'rules must list at least one BR id');
      continue;
    }
    const size = cluster.rules.length;
    if (size > CLUSTER_MAX_RULES) err(where, `${size} rules; split it (at most ${CLUSTER_MAX_RULES})`);
    if (size < CLUSTER_MIN_RULES) err(where, `needs at least ${CLUSTER_MIN_RULES} rule`);
    for (const id of cluster.rules) {
      if (!ruleIds.has(id)) err(where, `unknown rule ${id}`);
      else if (owner.has(id)) err(where, `${id} is already in ${owner.get(id)}`);
      owner.set(id, cluster.id);
    }
    byId.set(cluster.id, cluster.rules);
  }
  for (const id of ruleIds) if (!owner.has(id)) err('scope.clusters', `${id} is in no cluster`);
  return byId;
}

// ------------------------------------------------------------- rules/BR.json

function validateRuleCases(ruleId, inventoryRefs) {
  const file = join(workdir, 'rules', `${ruleId}.json`);
  const doc = load(file, ruleId);
  if (!doc) return null;
  if (doc.ruleId !== ruleId) err(ruleId, `ruleId must be ${ruleId}`);

  if (!isStringArray(doc.techniques)) err(ruleId, 'techniques: at least one');
  for (const technique of doc.techniques ?? [])
    if (!TECHNIQUES.includes(technique)) err(ruleId, `unknown technique ${technique}; use: ${TECHNIQUES.join(', ')}`);

  const coverage = Array.isArray(doc.coverage) ? doc.coverage : [];
  if (coverage.length === 0) err(ruleId, 'coverage: at least one row');
  const rowIds = uniqueIds(coverage, /^C\d+$/, `${ruleId}.coverage`, 'C1');
  for (const [index, row] of coverage.entries()) {
    const where = `${ruleId}.coverage[${index}] (${row?.id})`;
    if (!isNonEmptyString(row?.condition)) err(where, 'condition required');
    if (!isNonEmptyString(row?.expected)) err(where, 'expected required');
    else if (VAGUE.test(row.expected)) err(where, 'expected is vague; state what the user observes');
  }

  const cases = Array.isArray(doc.cases) ? doc.cases : [];
  if (cases.length === 0) err(ruleId, 'cases: at least one');
  const prefix = casePrefix(ruleId);
  const idPattern = new RegExp(`^${prefix}\\d{2,}$`);
  uniqueIds(cases, idPattern, `${ruleId}.cases`, `${prefix}01`);
  const covered = new Set();
  const titles = new Map();
  for (const [index, testCase] of cases.entries()) {
    const where = `${ruleId}.cases[${index}] (${testCase?.id})`;
    if (!isNonEmptyString(testCase?.title)) err(where, 'title required');
    else {
      if (testCase.title.length > 120) err(where, 'title longer than 120 characters');
      const key = normalize(testCase.title);
      if (titles.has(key)) err(where, `same title as ${titles.get(key)}`);
      titles.set(key, testCase.id);
    }
    if (!PRIORITIES.includes(testCase?.priority)) err(where, `priority must be ${PRIORITIES.join(' or ')}`);
    if (!CASE_TYPES.includes(testCase?.type)) err(where, `type must be one of: ${CASE_TYPES.join(', ')}`);
    if (!isStringArray(testCase?.preconditions, { allowEmpty: true }))
      err(where, 'preconditions must be an array of strings');
    if (!isStringArray(testCase?.data, { allowEmpty: true })) err(where, 'data must be an array of strings');
    if (!isStringArray(testCase?.steps)) err(where, 'steps: at least one');
    if (!isStringArray(testCase?.expected)) err(where, 'expected: at least one');
    for (const line of [...(testCase?.expected ?? []), ...(testCase?.steps ?? [])])
      if (typeof line === 'string' && VAGUE.test(line)) err(where, `vague wording: "${line}"`);

    if (!isStringArray(testCase?.covers)) err(where, 'covers: at least one coverage row id');
    for (const id of testCase?.covers ?? []) {
      if (!rowIds.has(id)) err(where, `covers unknown coverage row ${id}`);
      covered.add(id);
    }

    const existing = testCase?.existing ?? {};
    if (!STATUSES.includes(existing.status)) err(where, `existing.status must be one of: ${STATUSES.join(', ')}`);
    if (existing.status === 'NEW' && existing.ref) err(where, 'existing.ref must be absent when status is NEW');
    if (existing.status === 'COVERED' || existing.status === 'PARTIAL') {
      if (!isNonEmptyString(existing.ref)) err(where, `${existing.status} needs existing.ref`);
      else if (inventoryRefs && !inventoryRefs.has(existing.ref))
        err(where, `existing.ref is not in inventory.json: ${existing.ref}`);
    }
    if (existing.status === 'COVERED' && inventoryRefs?.get(existing.ref) === 'lower')
      err(where, 'COVERED needs an e2e-layer test; a lower-layer test is PARTIAL at most');
    if (existing.status === 'PARTIAL' && !isNonEmptyString(existing.missing))
      err(where, 'PARTIAL needs existing.missing (what the existing test does not check)');
  }

  for (const id of rowIds) if (!covered.has(id)) err(ruleId, `coverage row ${id} has no case`);
  if (cases.length > 0 && !cases.some((testCase) => testCase?.priority === 'smoke'))
    err(ruleId, 'at least one case must be priority smoke');

  for (const [index, question] of (doc.openQuestions ?? []).entries())
    if (!isNonEmptyString(question?.question)) err(`${ruleId}.openQuestions[${index}]`, 'question required');
  return doc;
}

// The same case written under two rules (within or across clusters).
function crossRuleDuplicates(docs) {
  const seen = new Map();
  for (const doc of docs)
    for (const testCase of doc?.cases ?? []) {
      if (!isNonEmptyString(testCase?.title)) continue;
      const key = normalize(testCase.title);
      const other = seen.get(key);
      if (other && other.ruleId !== doc.ruleId)
        err(testCase.id, `same title as ${other.id} under ${other.ruleId}; keep the case under one rule`);
      else seen.set(key, { id: testCase.id, ruleId: doc.ruleId });
    }
}

// ------------------------------------------------------- reviews/*.json files

function validateReviews() {
  const dir = join(workdir, 'reviews');
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir).filter((file) => file.endsWith('.json'))) {
    const doc = load(join(dir, name), `reviews/${name}`);
    if (!doc) continue;
    const allowed = name.startsWith('rules') ? RULE_FINDINGS : CASE_FINDINGS;
    if (!Array.isArray(doc.findings)) {
      err(`reviews/${name}`, 'findings must be an array (empty when clean)');
      continue;
    }
    for (const [index, finding] of doc.findings.entries()) {
      const where = `reviews/${name}.findings[${index}]`;
      if (!allowed.includes(finding?.type)) err(where, `type must be one of: ${allowed.join(', ')}`);
      if (!isNonEmptyString(finding?.target)) err(where, 'target required');
      if (!isNonEmptyString(finding?.detail)) err(where, 'detail required');
      if (!isNonEmptyString(finding?.proposal)) err(where, 'proposal required');
      if (finding?.resolution !== undefined) {
        if (!RESOLUTIONS.includes(finding.resolution))
          err(where, `resolution must be one of: ${RESOLUTIONS.join(', ')}`);
        if (finding.resolution !== 'applied' && !isNonEmptyString(finding.reason))
          err(where, `${finding.resolution} needs a reason`);
      }
    }
  }
}

// ----------------------------------------------------------------------- run

const scope = load(join(workdir, 'scope.json'), 'scope.json');
if (scope) {
  const { ruleIds } = validateScope(scope);
  if (stage !== 'rules') {
    const clusters = validateClusters(scope, ruleIds);
    if (stage === 'cluster' || stage === 'cases') {
      let inventoryRefs = null;
      const inventoryPath = join(workdir, 'inventory.json');
      if (existsSync(inventoryPath))
        inventoryRefs = new Map(readJson(inventoryPath).map((entry) => [entry.ref, entry.layer]));
      else err('inventory.json', 'missing; run inventory.mjs first');

      if (stage === 'cluster') {
        if (!clusters.has(onlyCluster)) err(onlyCluster, 'not a cluster in scope.json');
        else crossRuleDuplicates(clusters.get(onlyCluster).map((id) => validateRuleCases(id, inventoryRefs)));
      } else {
        crossRuleDuplicates([...ruleIds].map((id) => validateRuleCases(id, inventoryRefs)));
      }
    }
  }
  if (stage === 'rules' || stage === 'cases') validateReviews();
}

if (errors.length > 0) {
  for (const line of errors) console.error(`✗ ${line}`);
  console.error(`\nvalidate: ${errors.length} error(s)`);
  process.exit(1);
}
console.log(`validate (${stage}${onlyCluster ? ` ${onlyCluster}` : ''}): clean.`);
