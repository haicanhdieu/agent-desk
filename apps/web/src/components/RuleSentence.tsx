import type { ReactNode } from 'react';
import { CommandChip } from '@/ds';
import styles from './Composites.module.css';

export type RuleTarget = 'issue' | 'pr' | 'any';
export type RuleDraft = {
  command: string;
  target: RuleTarget;
  labels: string[];
  skill: string;
  agent: string;
  enabled: boolean;
};

const TARGET_WORDS: Record<RuleTarget, string> = {
  issue: 'an issue',
  pr: 'a pull request',
  any: 'an issue or pull request',
};

export const targetWords = (t: RuleTarget) => TARGET_WORDS[t];

export function RuleSentence({ rule, variant }: { rule: RuleDraft; variant: 'slots' | 'plain' }) {
  const labels = rule.labels.join(', ');
  const cmd = <CommandChip>/{rule.command}</CommandChip>;
  if (variant === 'plain') {
    return (
      <span className={styles.plain}>
        When {cmd} is posted on {TARGET_WORDS[rule.target]}
        {labels && (
          <>
            {' '}
            labelled <b>{labels}</b>
          </>
        )}
        , run <span className={styles.plainSkill}>{rule.skill}</span> with {rule.agent}
      </span>
    );
  }
  const slot = (c: ReactNode, mono?: boolean) => (
    <span className={[styles.slot, mono && styles.slotMono].filter(Boolean).join(' ')}>{c}</span>
  );
  return (
    <p className={styles.sentence}>
      When a comment starting with {cmd} is posted on {slot(TARGET_WORDS[rule.target])}
      {labels && <> labelled {slot(labels)}</>}, run skill {slot(rule.skill, true)} with agent {slot(rule.agent)}.
    </p>
  );
}
