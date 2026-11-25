import {
  AGENT_KIND_CAPABILITIES,
  type AgentDto,
  type PollInterval as PollSeconds,
  type ProjectConnectionDto,
  type RepoDto,
  type RuleDto,
} from '@agentdesk/contracts';
import type { PollInterval } from '@/mocks/types';
import { formatLimit } from '../duration';
import { relativeTime } from '../relativeTime';

const POLL_SECONDS = {
  '5 min': 300,
  '10 min': 600,
  '15 min': 900,
  '30 min': 1800,
} as const satisfies Record<PollInterval, PollSeconds>;

/** "10 min" → 600, the inverse of `pollIntervalLabel`. */
export const pollSeconds = (label: PollInterval): PollSeconds => POLL_SECONDS[label];

/** Last path segment of a repo, the default project name. */
export const repoName = (repoPath: string): string => repoPath.split('/').at(-1) ?? repoPath;

export const repoMeta = (repo: RepoDto): string =>
  `${repo.private ? 'Private' : 'Public'}, default branch ${repo.defaultBranch}`;

/** Clock time (UTC, as the fixtures and boards show it), e.g. "14:01:37". */
export const clockTime = (iso: string): string => new Date(iso).toISOString().slice(11, 19);

/**
 * Stepper detail of the credential step, e.g. "Claude Code, opus". The label comes from the capability table; a
 * kind that works without a credential (OpenCode) shows it too, and with no model it is the label alone.
 */
export const credentialDetail = (agent: AgentDto, model: string = agent.model): string | undefined => {
  const cap = AGENT_KIND_CAPABILITIES[agent.provider];
  if (!agent.credential.set && !cap.credentialOptional) return undefined;
  return model === '' ? cap.label : `${cap.label}, ${model}`;
};

export type SetupPolling =
  { state: 'checking' } | { state: 'ok'; lastChecked: string } | { state: 'failed'; reason: string };

/** Step `repo` revisited: what the server heard since the project was created. */
export function triggerProgress(dto: ProjectConnectionDto, now: Date): { pingAt?: string; polling?: SetupPolling } {
  if (dto.mode === 'webhook') {
    const at = dto.webhook?.lastEventAt;
    return at ? { pingAt: clockTime(at) } : {};
  }
  const p = dto.polling;
  const reason = p?.pausedReason ?? p?.lastError;
  if (reason) return { polling: { state: 'failed', reason: reason === 'token_revoked' ? 'token revoked' : reason } };
  if (p?.lastCheckedAt) return { polling: { state: 'ok', lastChecked: relativeTime(p.lastCheckedAt, now) } };
  return { polling: { state: 'checking' } };
}

/** SetupReady: what was heard last. */
export function lastEvent(dto: ProjectConnectionDto, now: Date): { mode: 'webhook' | 'polling'; at: string } {
  if (dto.mode === 'webhook') {
    const at = dto.webhook?.lastEventAt;
    const action = dto.webhook?.lastEventAction ?? 'event';
    return { mode: 'webhook', at: at ? `${action}, ${clockTime(at)}` : 'none yet' };
  }
  const at = dto.polling?.lastCheckedAt;
  return { mode: 'polling', at: at ? relativeTime(at, now) : 'not yet' };
}

/** SetupReady agent row, e.g. "Claude, opus, 30 min limit, 2 at a time". */
export const agentSummary = (agent: AgentDto, maxConcurrentRuns: number): string =>
  `${agent.name}, ${agent.model}, ${formatLimit(agent.timeoutSeconds)} limit, ${maxConcurrentRuns} at a time`;

const WHERE = { issue: 'on issues', pr: 'on pull requests', any: 'on issues and pull requests' } as const;

/** SetupReady rules row text after the command, e.g. "on issues labelled user-story". */
export const ruleWhere = (rule: RuleDto): string =>
  `${WHERE[rule.target]}${rule.labelFilter.length > 0 ? ` labelled ${rule.labelFilter.join(', ')}` : ''}`;
