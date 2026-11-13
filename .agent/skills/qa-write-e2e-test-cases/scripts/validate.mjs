#!/usr/bin/env node
// Mechanical checks on the drafts. Exit 0 = clean, 1 = errors (printed one per line).
// Warnings (possible duplicates a person should judge) are printed but do not fail the run.
//
//   node validate.mjs <workdir> rules          scope.json requirements and rules (after extraction / reconcile)
//   node validate.mjs <workdir> clusters       + scope.json clusters (after clustering)
//   node validate.mjs <workdir> cluster CL-02  + the rules/<BR>.json of one cluster (for its writer)
//   node validate.mjs <workdir> cases          + every rules/<BR>.json, duplicates across clusters, reviews
//
// Dedupe (every stage): near-duplicate rules and open questions, scored with token-set
// Jaccard similarity (thresholds in lib.mjs). A pair that is legitimately separate is
// kept by naming the other id in `distinctFrom` with a reason (schemas.md).
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
  RULE_DUPLICATE_SIMILARITY,
  QUESTION_DUPLICATE_SIMILARITY,
  QUESTION_POSSIBLE_SIMILARITY,
  QUESTION_POSSIBLE_CONTAINMENT,
  casePrefix,
  readJson,
  isNonEmptyString,
  isStringArray,
  tokenSet,
  jaccard,
  containment,
  aboutIds,
  isQuestionRef,
  declaredDistinct,
} from './lib.mjs';

const [workdir, stage = 'cases', onlyCluster] = process.argv.slice(2);
if (!workdir || !['rules', 'clusters', 'cluster', 'cases'].includes(stage) || (stage === 'cluster' && !onlyCluster)) {
  console.error('usage: node validate.mjs <workdir> rules|clusters|cluster CL-xx|cases');
  process.exit(2);
}

const errors = [];
const err = (where, message) => errors.push(`${where}: ${message}`);
const warnings = [];
const warn = (where, message) => warnings.push(`${where}: ${message}`);

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

// distinctFrom: [{ id, reason }]; `allowed` is the set of ids it may name.
function validateDistinctFrom(item, ownId, allowed, where) {
  if (item?.distinctFrom === undefined) return;
  if (!Array.isArray(item.distinctFrom) || item.distinctFrom.length === 0) {
    err(where, 'distinctFrom must be a non-empty array of { "id", "reason" }');
    return;
  }
  for (const [index, entry] of item.distinctFrom.entries()) {
    const at = `${where}.distinctFrom[${index}]`;
    if (!allowed.has(entry?.id) || entry.id === ownId) err(at, `unknown or self id ${JSON.stringify(entry?.id)}`);
    if (!isNonEmptyString(entry?.reason)) err(at, 'reason required (which test would differ, and why)');
  }
}

const fixed = (n) => n.toFixed(2);

// Text that names a scope.json question ("scope Q3", "Q3 of scope.json") instead of using a ref.
const SCOPE_Q_MENTION = /\bscope(?:\.json)?\s+(Q\d+)\b|\b(Q\d+)\s+(?:of|in)\s+scope(?:\.json)?\b/gi;
const scopeMentions = (text) => [...String(text).matchAll(SCOPE_Q_MENTION)].map((m) => (m[1] ?? m[2]).toUpperCase());

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
  for (const [index, rule] of rules.entries())
    validateDistinctFrom(rule, rule?.id, ruleIds, `scope.rules[${index}] (${rule?.id})`);
  ruleDuplicates(rules);

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
  const questionIds = uniqueIds(questions, /^Q\d+$/, 'scope.openQuestions', 'Q1');
  for (const [index, question] of questions.entries()) {
    const where = `scope.openQuestions[${index}] (${question?.id})`;
    if (!isNonEmptyString(question?.question)) err(where, 'question required');
    const about = question?.about;
    if (Array.isArray(about) ? about.length === 0 : about === undefined)
      err(where, 'about must be "scope", a requirement id, a rule id, or a list of requirement and rule ids');
    for (const id of aboutIds(question))
      if (id !== 'scope' && !reqIds.has(id) && !ruleIds.has(id))
        err(where, `about: unknown id ${JSON.stringify(id)}; use "scope", a requirement id or a rule id`);
    if (Array.isArray(about) && about.includes('scope')) err(where, 'about: "scope" stands alone, not in a list');
    validateDistinctFrom(question, question?.id, new Set([...questionIds, ...ruleIds]), where);
  }
  const registry = questions
    .filter((question) => isNonEmptyString(question?.id) && isNonEmptyString(question?.question))
    .map((question) => ({ where: `scope ${question.id}`, id: question.id, item: question }));
  questionDuplicates(registry, { errorAtDuplicate: true });

  return { ruleIds, registry };
}

// ------------------------------------------------------------------- dedupe

// Near-duplicate rule statements (error), and rules that share their requirement set and
// category, the usual sign of one rule split per field or per message type (warning).
function ruleDuplicates(rules) {
  const valid = rules.filter((rule) => isNonEmptyString(rule?.id) && isNonEmptyString(rule?.statement));
  const tokens = new Map(valid.map((rule) => [rule.id, tokenSet(rule.statement)]));
  for (const [i, a] of valid.entries())
    for (const b of valid.slice(i + 1)) {
      if (declaredDistinct(a, a.id, b, b.id)) continue;
      const score = jaccard(tokens.get(a.id), tokens.get(b.id));
      if (score >= RULE_DUPLICATE_SIMILARITY)
        err(
          `scope.rules (${b.id})`,
          `near-duplicate of ${a.id} (similarity ${fixed(score)} >= ${RULE_DUPLICATE_SIMILARITY}): merge them into one rule, ` +
            `or add "distinctFrom": [{ "id": "${a.id}", "reason": "…" }] if they need different tests`,
        );
    }

  const groups = new Map();
  for (const rule of valid) {
    if (!isStringArray(rule.requirements)) continue;
    const key = `${[...rule.requirements].sort().join('+')}|${rule.category}`;
    groups.set(key, [...(groups.get(key) ?? []), rule]);
  }
  for (const [key, group] of groups) {
    if (group.length < 2) continue;
    // Drop a rule only if it declared itself distinct from every other rule of the group.
    const undeclared = group.filter((a) => group.some((b) => b !== a && !declaredDistinct(a, a.id, b, b.id)));
    if (undeclared.length < 2) continue;
    const [reqs, category] = key.split('|');
    warn(
      `scope.rules (${undeclared.map((rule) => rule.id).join(', ')})`,
      `possible over-split: same requirements ${reqs.replaceAll('+', ', ')} and category ${category}. ` +
        'Rules that differ only by field, column or message type are one rule with more coverage rows; ' +
        'merge them, or justify each with distinctFrom',
    );
  }
}

// items: [{ where, id, item, owner? }]: open questions to compare pairwise. `id` is a Q id
// for a scope question; `owner` is the rule id for a per-rule question.
function questionDuplicates(items, { errorAtDuplicate, crossOwnerIsError = true, against = [] }) {
  const tokens = new Map([...items, ...against].map((entry) => [entry, tokenSet(entry.item.question)]));
  const idOf = (entry) => entry.id ?? entry.owner;
  const compare = (a, b, hint, isError) => {
    if (declaredDistinct(a.item, idOf(a), b.item, idOf(b))) return;
    const ta = tokens.get(a);
    const tb = tokens.get(b);
    const score = jaccard(ta, tb);
    if (score >= QUESTION_DUPLICATE_SIMILARITY) {
      (isError ? err : warn)(a.where, `restates ${b.where} (similarity ${fixed(score)}); ${hint}`);
    } else if (score >= QUESTION_POSSIBLE_SIMILARITY && containment(ta, tb) >= QUESTION_POSSIBLE_CONTAINMENT) {
      warn(
        a.where,
        `may restate ${b.where} (similarity ${fixed(score)}, containment ${fixed(containment(ta, tb))}); ${hint}, ` +
          'or add distinctFrom with a reason if it asks something else',
      );
    }
  };
  for (const a of items)
    for (const b of against.filter((entry) => !scopeMentions(a.item.question).includes(entry.id)))
      compare(a, b, `replace it with {"ref":"${b.id}"} (add "detail" for what is specific to this rule)`, true);
  for (const [i, a] of items.entries())
    for (const b of items.slice(i + 1)) {
      const sameOwner = a.owner !== undefined && a.owner === b.owner;
      if (a.owner === undefined) compare(b, a, 'merge the two scope questions into one', errorAtDuplicate);
      else if (sameOwner) compare(b, a, 'keep one', true);
      else
        compare(
          b,
          a,
          `the orchestrator moves it into scope.json openQuestions (about: ["${a.owner}", "${b.owner}"]) and both rules use {"ref":"Qn"}`,
          crossOwnerIsError,
        );
    }
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

function validateRuleCases(ruleId, inventoryRefs, registry, ruleIdsAll) {
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

  const registryIds = new Set(registry.map((entry) => entry.id));
  if (doc.openQuestions !== undefined && !Array.isArray(doc.openQuestions))
    err(ruleId, 'openQuestions must be an array');
  for (const [index, question] of (Array.isArray(doc.openQuestions) ? doc.openQuestions : []).entries()) {
    const where = `${ruleId}.openQuestions[${index}]`;
    if (isQuestionRef(question)) {
      if (!registryIds.has(question.ref))
        err(where, `ref ${JSON.stringify(question.ref)} is not a scope.json question id`);
      if (question.question !== undefined)
        err(where, 'a ref has no "question"; put what is specific to this rule in "detail"');
      if (question.detail !== undefined && !isNonEmptyString(question.detail))
        err(where, 'detail must be a non-empty string');
      continue;
    }
    if (!isNonEmptyString(question?.question)) {
      err(where, 'question required (or {"ref":"Qn"} to point at a scope.json question)');
      continue;
    }
    for (const id of scopeMentions(question.question))
      if (registryIds.has(id))
        err(
          where,
          `names scope ${id}; replace it with {"ref":"${id}"} (add "detail" for what is specific to this rule)`,
        );
    validateDistinctFrom(question, ruleId, new Set([...registryIds, ...ruleIdsAll]), where);
  }
  return doc;
}

// Per-rule open questions against the scope.json registry and each other, and case notes
// that only repeat an open question. Cross-rule repeats are warnings while one writer sees
// only its cluster, and errors once every rule is in (stage "cases").
function ruleQuestionDuplicates(docs, registry, { crossOwnerIsError }) {
  const items = [];
  for (const doc of docs.filter(Boolean))
    for (const [index, question] of (Array.isArray(doc.openQuestions) ? doc.openQuestions : []).entries())
      if (!isQuestionRef(question) && isNonEmptyString(question?.question))
        items.push({ where: `${doc.ruleId}.openQuestions[${index}]`, owner: doc.ruleId, item: question });
  questionDuplicates(items, { errorAtDuplicate: true, crossOwnerIsError, against: registry });

  for (const doc of docs.filter(Boolean)) {
    const questions = [
      ...registry.map((entry) => ({ label: entry.id, text: entry.item.question })),
      ...items
        .filter((entry) => entry.owner === doc.ruleId)
        .map((entry) => ({ label: entry.where, text: entry.item.question })),
    ];
    for (const testCase of Array.isArray(doc.cases) ? doc.cases : []) {
      if (!isNonEmptyString(testCase?.note)) continue;
      const where = `${doc.ruleId}.cases (${testCase.id}).note`;
      const names = /\bQ\d+\b/.test(testCase.note);
      if (/\bopen question/i.test(testCase.note) && !names) {
        warn(
          where,
          'points at "the open questions" without naming one; the question is already listed. ' +
            'Write "Depends on Qn" for a scope.json question, or drop the note',
        );
        continue;
      }
      const noteTokens = tokenSet(testCase.note);
      for (const question of questions) {
        const questionTokens = tokenSet(question.text);
        const score = jaccard(noteTokens, questionTokens);
        if (
          score >= QUESTION_DUPLICATE_SIMILARITY ||
          (score >= QUESTION_POSSIBLE_SIMILARITY &&
            containment(noteTokens, questionTokens) >= QUESTION_POSSIBLE_CONTAINMENT)
        )
          warn(
            where,
            `repeats open question ${question.label} (similarity ${fixed(score)}); ` +
              'say only "Depends on Qn" (or drop the note), the question itself is listed once',
          );
      }
    }
  }
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
  const { ruleIds, registry } = validateScope(scope);
  const validateRule = (id, inventoryRefs) => validateRuleCases(id, inventoryRefs, registry, ruleIds);
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
        else {
          const docs = clusters.get(onlyCluster).map((id) => validateRule(id, inventoryRefs));
          crossRuleDuplicates(docs);
          ruleQuestionDuplicates(docs, registry, { crossOwnerIsError: false });
        }
      } else {
        const docs = [...ruleIds].map((id) => validateRule(id, inventoryRefs));
        crossRuleDuplicates(docs);
        ruleQuestionDuplicates(docs, registry, { crossOwnerIsError: true });
      }
    }
  }
  if (stage === 'rules' || stage === 'cases') validateReviews();
}

for (const line of warnings) console.error(`! ${line}`);
if (errors.length > 0) {
  for (const line of errors) console.error(`✗ ${line}`);
  console.error(`\nvalidate: ${errors.length} error(s), ${warnings.length} warning(s)`);
  process.exit(1);
}
const suffix =
  warnings.length > 0 ? ` ${warnings.length} warning(s) above: fix each, or leave it if you judged it distinct.` : '';
console.log(`validate (${stage}${onlyCluster ? ` ${onlyCluster}` : ''}): clean.${suffix}`);
