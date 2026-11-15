import { RULE_PROMPT_MAX } from '@agentdesk/contracts';
import { Field, LabelInput, PrefixInput, Select, SegmentedControl, TextArea, Toggle } from '@/ds';
import { PromptSystemPart, type PromptPreview } from './PromptSystemPart';
import { RuleSentence, type RuleDraft, type RuleKind, type RuleTarget } from './RuleSentence';
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
  /** Field-level messages (e.g. from a problem+json response); the field is marked invalid and described by it. */
  errors?: Partial<Record<'command' | 'labels' | 'target' | 'skill' | 'prompt', string>>;
  /** The system lines Agent Desk adds to a custom prompt. With it, the form offers Skill / Custom prompt; without it, skill only. */
  promptPreview?: PromptPreview;
}

/** Longest custom prompt the API accepts. */
export const PROMPT_MAX = RULE_PROMPT_MAX;

const KINDS: { value: RuleKind; label: string }[] = [
  { value: 'skill', label: 'Skill' },
  { value: 'prompt', label: 'Custom prompt' },
];

const TARGETS: { value: RuleTarget; label: string }[] = [
  { value: 'issue', label: 'Issue' },
  { value: 'pr', label: 'Pull request' },
  { value: 'any', label: 'Any' },
];

/** Keep a saved value selectable even when it is no longer in the option list (e.g. a deleted skill). */
const withCurrent = (opts: string[], cur: string) => (opts.includes(cur) ? opts : [cur, ...opts]);

export function RuleForm({
  value,
  skills,
  agents,
  onChange,
  agentLocked,
  agentModel,
  spacious,
  errors,
  promptPreview,
}: RuleFormProps) {
  const set = (patch: Partial<RuleDraft>) => onChange({ ...value, ...patch });
  const kind: RuleKind = promptPreview ? (value.kind ?? 'skill') : 'skill';
  const promptLength = (value.prompt ?? '').length;
  return (
    <div className={spacious ? `${styles.form} ${styles.formSpacious}` : styles.form}>
      <div className={styles.sentenceCard}>
        <RuleSentence rule={value} variant="slots" />
      </div>
      <div className={styles.grid2}>
        <Field
          label="Command"
          help="First line of the comment. Text after it is passed to the agent."
          error={errors?.command}
        >
          {({ id, describedBy, invalid }) => (
            <PrefixInput
              prefix="/"
              id={id}
              aria-describedby={describedBy}
              aria-invalid={invalid}
              value={value.command}
              onChange={(e) => set({ command: e.target.value })}
            />
          )}
        </Field>
        <Field label="Posted on" labelAs="span" error={errors?.target}>
          {({ labelId, describedBy, invalid }) => (
            <SegmentedControl
              aria-labelledby={labelId}
              aria-describedby={describedBy}
              aria-invalid={invalid}
              value={value.target}
              options={TARGETS}
              onChange={(target) => set({ target })}
            />
          )}
        </Field>
        <Field
          label="Only if the ticket has all labels"
          help="Optional. Leave empty to match any ticket."
          error={errors?.labels}
        >
          {({ id, describedBy, invalid }) => (
            <LabelInput
              id={id}
              aria-describedby={describedBy}
              aria-invalid={invalid}
              labels={value.labels}
              placeholder="Add label"
              onAdd={(l) => !value.labels.includes(l) && set({ labels: [...value.labels, l] })}
              onRemove={(l) => set({ labels: value.labels.filter((x) => x !== l) })}
            />
          )}
        </Field>
        {promptPreview && (
          <Field label="Run" labelAs="span">
            {({ labelId }) => (
              <SegmentedControl
                aria-labelledby={labelId}
                value={kind}
                options={KINDS}
                onChange={(next) => set({ kind: next })}
              />
            )}
          </Field>
        )}
        {!promptPreview || kind === 'skill' ? (
          <Field
            label={promptPreview ? 'Skill' : 'Run skill'}
            help={
              <>
                From <span className="mono">.claude/skills/</span> on main.
              </>
            }
            error={errors?.skill}
          >
            {({ id, describedBy, invalid }) => (
              <Select
                mono
                id={id}
                aria-describedby={describedBy}
                aria-invalid={invalid}
                value={value.skill}
                onChange={(e) => set({ skill: e.target.value })}
              >
                {withCurrent(skills, value.skill).map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </Select>
            )}
          </Field>
        ) : (
          <>
            <Field
              className={styles.full}
              label="Prompt"
              help={
                <span className={styles.promptHelp}>
                  <span>Don&apos;t paste passwords or tokens. This text is stored.</span>
                  <span
                    className={[styles.counter, promptLength > PROMPT_MAX && styles.counterOver]
                      .filter(Boolean)
                      .join(' ')}
                  >
                    {promptLength} / {PROMPT_MAX}
                  </span>
                </span>
              }
              error={errors?.prompt}
            >
              {({ id, describedBy, invalid }) => (
                <TextArea
                  id={id}
                  aria-describedby={describedBy}
                  aria-invalid={invalid}
                  placeholder="Tell the agent what to do on the ticket"
                  value={value.prompt ?? ''}
                  onChange={(e) => set({ prompt: e.target.value })}
                />
              )}
            </Field>
            <div className={styles.full}>
              <PromptSystemPart preview={promptPreview} />
            </div>
          </>
        )}
        <Field label="With agent" help="One agent per project in the PoC.">
          {({ id, describedBy }) => (
            <Select
              id={id}
              aria-describedby={describedBy}
              disabled={agentLocked}
              value={value.agent}
              onChange={(e) => set({ agent: e.target.value })}
            >
              {withCurrent(agents, value.agent).map((a) => (
                <option key={a} value={a}>
                  {agentModel ? `${a} (${agentModel})` : a}
                </option>
              ))}
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
