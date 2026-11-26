import type { ReactNode } from 'react';
import { CommandChip } from '@/ds';
import styles from './Composites.module.css';

export type RuleTarget = 'issue' | 'pr' | 'any';
/** What a rule runs: a skill from the repo, or a custom prompt typed in the form. */
export type RuleKind = 'skill' | 'prompt';
export type RuleDraft = {
  command: string;
  target: RuleTarget;
  labels: string[];
  skill: string;
  /** The agent this rule names; null follows the project default. */
  agentId: string | null;
  /** The agent's name for display; absent with `agentId` null. */
  agentLabel?: string;
  enabled: boolean;
  /** Absent means `skill`. */
  kind?: RuleKind;
  /** The custom prompt of a `prompt` rule, as written (multi-line). */
  prompt?: string;
  /** The model this rule asks for. Absent or null follows the agent's default model; '' is an unfinished Other model… and is not saveable. RuleSentence shows a non-empty one after the agent name, as Agent(model). */
  model?: string | null;
};

/** One choice in the rule form's agent select. */
export interface RuleAgentOption {
  id: string;
  label: string;
  provider: string;
  /** True when a run on this agent fails without a credential (its kind does not make one optional). */
  needsCredential: boolean;
  /** The agent's default model, for the Model help. */
  model?: string;
  /** The last known credential check; drives the row warning. */
  connection?: 'ok' | 'invalid' | 'rejected' | 'unreachable' | 'unsupported' | 'no_credential';
}

/** The row warning for a rule's agent: no credential on a kind that needs one, or a rejected credential. */
export function ruleAgentWarning(agent: RuleAgentOption): string | undefined {
  const bad = agent.connection === 'rejected' || (agent.connection === 'no_credential' && agent.needsCredential);
  return bad ? `${agent.label} has no working credential. Runs from this rule will fail.` : undefined;
}

/** The first non-empty line of a custom prompt, shown where a skill rule shows its skill name. */
export const promptFirstLine = (prompt: string | undefined) =>
  (prompt ?? '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find(Boolean) ?? '';

const TARGET_WORDS: Record<RuleTarget, string> = {
  issue: 'an issue',
  pr: 'a pull request',
  any: 'an issue or pull request',
};

export const targetWords = (t: RuleTarget) => TARGET_WORDS[t];

export function RuleSentence({ rule, variant }: { rule: RuleDraft; variant: 'slots' | 'plain' }) {
  const labels = rule.labels.join(', ');
  const agentName = rule.agentLabel ?? rule.agentId;
  const agent = rule.model ? `${agentName}(${rule.model})` : agentName;
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
        , run{' '}
        {rule.kind === 'prompt' ? (
          <>
            <b>Custom prompt</b> <span className={styles.plainPrompt}>{promptFirstLine(rule.prompt)}</span>
          </>
        ) : (
          <span className={styles.plainSkill}>{rule.skill}</span>
        )}{' '}
        with {rule.agentId === null ? 'the project default agent' : agent}
      </span>
    );
  }
  const slot = (c: ReactNode, mono?: boolean) => (
    <span className={[styles.slot, mono && styles.slotMono].filter(Boolean).join(' ')}>{c}</span>
  );
  return (
    <p className={styles.sentence}>
      When a comment starting with {cmd} is posted on {slot(TARGET_WORDS[rule.target])}
      {labels && <> labelled {slot(labels)}</>},{' '}
      {rule.kind === 'prompt' ? <>run {slot('a custom prompt')}</> : <>run skill {slot(rule.skill, true)}</>} with{' '}
      {rule.agentId === null ? slot('the project default agent') : <>agent {slot(agent)}</>}.
    </p>
  );
}
