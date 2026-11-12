import type { AgentDto, RuleDto, SkillSummaryDto } from '@agentdesk/contracts';
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

/**
 * A rule for the Desk screen. With the repo's skill names, a rule whose skill is missing gets the board's warning
 * (comments with its command are ignored until the skill exists).
 */
export function toRule(dto: RuleDto, agent: AgentDto, now: Date, skillNames?: string[]): Rule {
  const missing = skillNames !== undefined && !skillNames.includes(dto.skillName);
  return {
    id: dto.id,
    command: dto.command,
    target: dto.target,
    labels: dto.labelFilter,
    skill: dto.skillName,
    agent: agent.name,
    enabled: dto.enabled,
    stats: ruleStats(dto.stats, now),
    ...(missing && {
      warning: `Skill ${dto.skillName} is not in .claude/skills/ on main. Comments with /${dto.command} are ignored until you add it or pick another skill.`,
    }),
  };
}
