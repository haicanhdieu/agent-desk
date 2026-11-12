import type { RuleDto, SkillSummaryDto } from '@agentdesk/contracts';
import type { Skill } from '@/mocks/types';
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
