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

export const RULE_FINDINGS = ['MISSING', 'SPLIT', 'MERGE', 'NOT_A_RULE', 'UNTRACEABLE', 'AMBIGUOUS', 'WRONG_CATEGORY'];
export const CASE_FINDINGS = [
  'GAP',
  'DUPLICATE',
  'VAGUE_EXPECTED',
  'NOT_FROM_SPEC',
  'NOT_ATOMIC',
  'WRONG_STATUS',
  'WRONG_PRIORITY',
];
export const RESOLUTIONS = ['applied', 'rejected', 'open-question'];

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
