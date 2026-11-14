import { CommandChip, Icon, Toggle } from '@/ds';
import type { RuleTarget } from './RuleSentence';
import styles from './Composites.module.css';

export interface FollowUpRuleProps {
  command: string;
  target: RuleTarget;
  skill: string;
  enabled: boolean;
  onChange?(v: boolean): void;
}

const WHERE: Record<RuleTarget, string> = {
  issue: 'on issues',
  pr: 'on pull requests',
  any: 'on issues and pull requests',
};

/** One-line opt-in to a second rule that follows the first (Setup 4). */
export function FollowUpRule({ command, target, skill, enabled, onChange }: FollowUpRuleProps) {
  return (
    <div className={styles.followUp}>
      <Icon name="rule" size={15} />
      <span className={styles.followUpMuted}>Also add the follow-up rule</span>
      <CommandChip>/{command}</CommandChip>
      <span className={styles.followUpMuted}>{WHERE[target]}, run</span>
      <span className={styles.followUpSkill}>{skill}</span>
      <span className={styles.followUpSpacer} />
      <Toggle aria-label={`Also add ${command} rule`} checked={enabled} onChange={(v) => onChange?.(v)} />
    </div>
  );
}
