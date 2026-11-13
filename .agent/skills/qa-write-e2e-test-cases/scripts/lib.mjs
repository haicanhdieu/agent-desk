// Shared vocabulary and helpers for the qa-write-e2e-test-cases scripts.
// The vocabularies here are the single source of truth; schemas.md documents them.
import { readFileSync } from 'node:fs';

export const CATEGORIES = [
  'validation',
  'state-transition',
  'permission',
  'conditional-display',
  'calculation',
  'limit',
  'navigation',
  'feedback-state',
  'persistence',
  'side-effect',
];

export const TECHNIQUES = [
  'equivalence-partitioning',
  'boundary-values',
  'decision-table',
  'state-transition',
  'role-matrix',
  'use-case-flow',
  'error-guessing',
];

export const CASE_TYPES = ['positive', 'negative', 'boundary', 'state', 'permission'];
export const PRIORITIES = ['smoke', 'full'];
export const STATUSES = ['NEW', 'PARTIAL', 'COVERED'];

// Open-question findings, raised by both reviewers.
const QUESTION_FINDINGS = ['DUPLICATE_QUESTION', 'ANSWERED_QUESTION'];

export const RULE_FINDINGS = [
  'MISSING',
  'SPLIT',
  'MERGE',
  'NOT_A_RULE',
  'UNTRACEABLE',
  'AMBIGUOUS',
  'WRONG_CATEGORY',
  ...QUESTION_FINDINGS,
];
export const CASE_FINDINGS = [
  'GAP',
  'DUPLICATE',
  'VAGUE_EXPECTED',
  'NOT_FROM_SPEC',
  'NOT_ATOMIC',
  'WRONG_STATUS',
  'WRONG_PRIORITY',
  ...QUESTION_FINDINGS,
];
export const RESOLUTIONS = ['applied', 'rejected', 'open-question'];

// Dedupe thresholds, on token-set Jaccard similarity (see tokenSet / jaccard below).
// Rules: two statements this similar state the same condition and outcome -> error.
export const RULE_DUPLICATE_SIMILARITY = 0.8;
// Questions are rephrased more freely than rule statements, so the bar is lower.
// At or above DUPLICATE -> error; at or above POSSIBLE with high containment -> warning.
export const QUESTION_DUPLICATE_SIMILARITY = 0.6;
export const QUESTION_POSSIBLE_SIMILARITY = 0.4;
export const QUESTION_POSSIBLE_CONTAINMENT = 0.7;

// Cluster size: one sub-issue, one writer, one reviewer each.
export const CLUSTER_MIN_RULES = 1;
export const CLUSTER_MAX_RULES = 8;

export const LABEL_SCOPE = 'qa:e2e-scope';
export const LABEL_CLUSTER = 'qa:e2e-cluster';
export const LABEL_LEGACY_RULE = 'qa:e2e-rule'; // earlier versions published one issue per rule

export const scopeMarker = (slug) => `<!-- qa-e2e:scope=${slug} -->`;
export const clusterMarker = (slug, clusterId) => `<!-- qa-e2e:cluster=${slug}/${clusterId} -->`;
export const ruleMarker = (ruleId) => `<!-- qa-e2e:rule=${ruleId} -->`;

// BR-07 -> TC-BR07-
export const casePrefix = (ruleId) => `TC-${ruleId.replace('-', '')}-`;

export function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

export function isStringArray(value, { allowEmpty = false } = {}) {
  return Array.isArray(value) && (allowEmpty || value.length > 0) && value.every(isNonEmptyString);
}

// ------------------------------------------------------------------- dedupe

const STOP_WORDS = new Set(
  (
    'a an the and or but nor of to in on at for with by from as into onto out over up down after before about ' +
    'is are was were be been being am it its this that these those there their they them then than so such ' +
    'do does did can could should would will may might must not no if when while what which who whom how where whether ' +
    'any each every some own same only also just'
  ).split(' '),
);

// Lowercase, drop possessives, punctuation and stop-words, and a trailing plural "s",
// so "the agent's tool calls" and "agent tool call" compare equal.
export function tokenSet(text) {
  return new Set(
    String(text)
      .toLowerCase()
      .replace(/['’]s\b/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .split(' ')
      .filter((word) => word && !STOP_WORDS.has(word))
      .map((word) => (word.length > 3 && word.endsWith('s') && !word.endsWith('ss') ? word.slice(0, -1) : word)),
  );
}

const shared = (a, b) => [...a].filter((token) => b.has(token)).length;

// |A ∩ B| / |A ∪ B|
export function jaccard(a, b) {
  const both = shared(a, b);
  const union = a.size + b.size - both;
  return union === 0 ? 0 : both / union;
}

// |A ∩ B| / min(|A|, |B|): high when one text restates the other plus extra words.
export function containment(a, b) {
  const smaller = Math.min(a.size, b.size);
  return smaller === 0 ? 0 : shared(a, b) / smaller;
}

// openQuestions[].about is one id or a list of ids.
export const aboutIds = (question) => (Array.isArray(question?.about) ? question.about : [question?.about]);

// A per-rule open question that points at a scope.json question instead of restating it.
export const isQuestionRef = (question) => question != null && Object.hasOwn(question, 'ref');

// distinctFrom: [{ id, reason }] on a rule or an open question; true if either side names the other.
export const declaredDistinct = (a, aId, b, bId) =>
  (a?.distinctFrom ?? []).some((entry) => entry?.id === bId) ||
  (b?.distinctFrom ?? []).some((entry) => entry?.id === aId);
