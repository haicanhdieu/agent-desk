import type { AgentConnectionDto, AgentDto, RuleDto, SkillSummaryDto } from '@agentdesk/contracts';
import { ruleAgentWarning, type RuleAgentOption } from '@/components/RuleSentence';
import type { Rule, Skill } from '@/mocks/types';
import { relativeTime } from '../relativeTime';

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** "No rules", "1 rule", "2 rules", "1 rule, off" (all off) or "2 rules, 1 off". */
export function ruleSummary(skillName: string, rules: RuleDto[]): string {
  const using = rules.filter((r) => r.skillName === skillName);
  if (using.length === 0) return 'No rules';
  const off = using.filter((r) => !r.enabled).length;
  const count = plural(using.length, 'rule');
  if (off === 0) return count;
  return off === using.length ? `${count}, off` : `${count}, ${off} off`;
}

/** Commands ("/code-e2e") of the rules that use the skill, for the delete warning. */
export function rulesUsing(skillName: string, rules: RuleDto[]): string[] {
  return rules.filter((r) => r.skillName === skillName).map((r) => `/${r.command}`);
}

/**
 * A skill for the Desk screen. List entries carry no body (only `skills.get` does). `lastCommit` is
 * "<short sha>, <relative>" because the screen shows the sha in mono before the comma; empty when never committed.
 */
export function toSkill(dto: SkillSummaryDto & { body?: string }, rules: RuleDto[], now: Date): Skill {
  return {
    name: dto.name,
    description: dto.description,
    body: dto.body ?? '',
    path: dto.path,
    ruleSummary: ruleSummary(dto.name, rules),
    lastCommit: dto.lastCommit ? `${dto.lastCommit.sha.slice(0, 7)}, ${relativeTime(dto.lastCommit.at, now)}` : '',
  };
}

/** "14 runs in 30 days · last 2 min ago", or "Never ran" when the rule has no run at all. Pass `useNow()`. */
export function ruleStats(stats: RuleDto['stats'], now: Date): string {
  if (stats.lastRunAt === null) return stats.runs30d === 0 ? 'Never ran' : `${plural(stats.runs30d, 'run')} in 30 days`;
  return `${plural(stats.runs30d, 'run')} in 30 days · last ${relativeTime(stats.lastRunAt, now)}`;
}

/** The last known credential check of an agent: none saved, else the last test (none yet reads as unknown). */
const connectionOf = (a: AgentDto): AgentConnectionDto['status'] | undefined =>
  a.credential.set ? a.lastTest?.status : 'no_credential';

/** One choice of the rule form's agent select. */
export function toRuleAgentOption(a: AgentDto): RuleAgentOption {
  return { id: a.id, label: a.name, provider: a.provider, model: a.model, connection: connectionOf(a) };
}

/** What a rule shows for an agent the reader cannot see or that no longer exists: never its raw id. */
export const UNAVAILABLE_AGENT = 'Unavailable agent';
/** What a rule shows for its agent while the agent list is loading: never its raw id, and not yet Unavailable. */
export const LOADING_AGENT = 'Loading agent…';

/**
 * A rule for the Desk screen. With the repo's skill names, a rule whose skill is missing gets the board's warning
 * (comments with its command are ignored until the skill exists). A rule that names an agent shows its name, and a
 * warning when that agent has no working credential (`agents` undefined: the list is still loading, so a neutral label); a rule with no agent follows the project default and shows none.
 */
export function toRule(dto: RuleDto, agents: AgentDto[] | undefined, now: Date, skillNames?: string[]): Rule {
  const missing = dto.skillName !== null && skillNames !== undefined && !skillNames.includes(dto.skillName);
  const agent = dto.agentId === null ? undefined : agents?.find((a) => a.id === dto.agentId);
  const warning = [
    missing &&
      `Skill ${dto.skillName} is not in .claude/skills/ on main. Comments with /${dto.command} are ignored until you add it or pick another skill.`,
    agent && ruleAgentWarning(toRuleAgentOption(agent)),
  ]
    .filter((w): w is string => typeof w === 'string')
    .join(' ');
  return {
    id: dto.id,
    command: dto.command,
    target: dto.target,
    labels: dto.labelFilter,
    skill: dto.skillName ?? '',
    kind: dto.kind,
    ...(dto.prompt !== null && { prompt: dto.prompt }),
    agentId: dto.agentId,
    ...(dto.agentId !== null && {
      agentLabel: agents === undefined ? LOADING_AGENT : agent ? agent.name : UNAVAILABLE_AGENT,
    }),
    model: dto.model,
    enabled: dto.enabled,
    stats: ruleStats(dto.stats, now),
    ...(warning !== '' && { warning }),
  };
}
