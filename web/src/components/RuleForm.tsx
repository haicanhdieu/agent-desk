import { Field, LabelInput, PrefixInput, Select, SegmentedControl, Toggle } from '@/ds';
import { RuleSentence, type RuleDraft, type RuleTarget } from './RuleSentence';
import styles from './Composites.module.css';

export interface RuleFormProps {
  value: RuleDraft;
  skills: string[];
  agents: string[];
  onChange(v: RuleDraft): void;
  agentLocked?: boolean;
  /** Shown after the agent name in the agent option, e.g. "Claude (opus)". */
  agentModel?: string;
  /** Setup page spacing: 24px between the sentence card and the fields (the desk pane keeps 16px). */
  spacious?: boolean;
}

const TARGETS: { value: RuleTarget; label: string }[] = [
  { value: 'issue', label: 'Issue' },
  { value: 'pr', label: 'Pull request' },
  { value: 'any', label: 'Any' },
];

/** Keep a saved value selectable even when it is no longer in the option list (e.g. a deleted skill). */
const withCurrent = (opts: string[], cur: string) => (opts.includes(cur) ? opts : [cur, ...opts]);

export function RuleForm({ value, skills, agents, onChange, agentLocked, agentModel, spacious }: RuleFormProps) {
  const set = (patch: Partial<RuleDraft>) => onChange({ ...value, ...patch });
  return (
    <div className={spacious ? `${styles.form} ${styles.formSpacious}` : styles.form}>
      <div className={styles.sentenceCard}>
        <RuleSentence rule={value} variant="slots" />
      </div>
      <div className={styles.grid2}>
        <Field label="Command" help="First line of the comment. Text after it is passed to the agent.">
          {({ id, describedBy }) => (
            <PrefixInput prefix="/" id={id} aria-describedby={describedBy} value={value.command} onChange={(e) => set({ command: e.target.value })} />
          )}
        </Field>
        <Field label="Posted on" labelAs="span">
          {({ labelId }) => (
            <SegmentedControl aria-labelledby={labelId} value={value.target} options={TARGETS} onChange={(target) => set({ target })} />
          )}
        </Field>
        <Field label="Only if the ticket has all labels" help="Optional. Leave empty to match any ticket.">
          {({ id }) => (
            <LabelInput
              id={id}
              labels={value.labels}
              placeholder="Add label"
              onAdd={(l) => !value.labels.includes(l) && set({ labels: [...value.labels, l] })}
              onRemove={(l) => set({ labels: value.labels.filter((x) => x !== l) })}
            />
          )}
        </Field>
        <Field label="Run skill" help={<>From <span className="mono">.claude/skills/</span> on main.</>}>
          {({ id, describedBy }) => (
            <Select mono id={id} aria-describedby={describedBy} value={value.skill} onChange={(e) => set({ skill: e.target.value })}>
              {withCurrent(skills, value.skill).map((s) => <option key={s}>{s}</option>)}
            </Select>
          )}
        </Field>
        <Field label="With agent" help="One agent per project in the PoC.">
          {({ id, describedBy }) => (
            <Select id={id} aria-describedby={describedBy} disabled={agentLocked} value={value.agent} onChange={(e) => set({ agent: e.target.value })}>
              {withCurrent(agents, value.agent).map((a) => <option key={a} value={a}>{agentModel ? `${a} (${agentModel})` : a}</option>)}
            </Select>
          )}
        </Field>
        <Field label="Enabled" labelAs="span">
          {({ labelId }) => (
            <span className={styles.enabledRow}>
              <Toggle aria-labelledby={labelId} checked={value.enabled} onChange={(enabled) => set({ enabled })} />
              <span className={styles.enabledText}>Matches new comments right away</span>
            </span>
          )}
        </Field>
      </div>
    </div>
  );
}
