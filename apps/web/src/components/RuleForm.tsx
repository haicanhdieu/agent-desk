import type { ReactNode } from 'react';
import { RULE_PROMPT_MAX } from '@agentdesk/contracts';
import { Field, LabelInput, PrefixInput, Select, SegmentedControl, TextArea, Toggle } from '@/ds';
import { ModelPicker, type ModelList } from './ModelPicker';
import { PromptSystemPart, type PromptPreview } from './PromptSystemPart';
import { RuleSentence, type RuleAgentOption, type RuleDraft, type RuleKind, type RuleTarget } from './RuleSentence';
import styles from './Composites.module.css';

export interface RuleFormProps {
  value: RuleDraft;
  skills: string[];
  /** The repo folders the skills come from, in order; the Skill help names them. Defaults to `.claude/skills`. */
  skillFolders?: string[];
  agents: RuleAgentOption[];
  /** The project default agent's name, for the first option "Project default (<name>)". */
  defaultAgentName?: string;
  /** `loading`: the agent list is still coming; the select is disabled. */
  agentsState?: 'ready' | 'loading';
  onChange(v: RuleDraft): void;
  /** The reader cannot see the agent list (no `agent:read`): the rule keeps its agent. */
  agentLocked?: boolean;
  /** With it, the form shows a "Model" field (Default model first) after "With agent". */
  modelField?: { list: ModelList; help: ReactNode };
  /** Setup page spacing: 24px between the sentence card and the fields (the desk pane keeps 16px). */
  spacious?: boolean;
  /** Field-level messages (e.g. from a problem+json response); the field is marked invalid and described by it. */
  errors?: Partial<Record<'command' | 'labels' | 'target' | 'skill' | 'prompt' | 'model', string>>;
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

const projectDefaultLabel = (name?: string) => (name ? `Project default (${name})` : 'Project default');

/** Keep a saved value selectable even when it is no longer in the option list (e.g. a deleted skill). */
const withCurrent = (opts: string[], cur: string) => (opts.includes(cur) ? opts : [cur, ...opts]);

export function RuleForm({
  value,
  skills,
  skillFolders = ['.claude/skills'],
  agents,
  defaultAgentName,
  agentsState = 'ready',
  onChange,
  agentLocked,
  modelField,
  spacious,
  errors,
  promptPreview,
}: RuleFormProps) {
  const set = (patch: Partial<RuleDraft>) => onChange({ ...value, ...patch });
  const kind: RuleKind = promptPreview ? (value.kind ?? 'skill') : 'skill';
  const current = value.agentId === null ? undefined : agents.find((a) => a.id === value.agentId);
  const gone = value.agentId !== null && !current && !agentLocked && agentsState === 'ready';
  const currentName = value.agentLabel ?? value.agentId ?? '';
  const agentHelp = gone
    ? 'This agent no longer exists. Pick another agent or the project default before you save.'
    : agentLocked
      ? 'You can’t see the agent list. This rule keeps its agent.'
      : 'Runs use the project default when this stays on Project default.';
  const modelHelp = gone
    ? 'The model of the deleted agent. Pick an agent to see its models.'
    : current?.model
      ? `Default model of ${current.label} is ${current.model}, set on Agent & settings.`
      : modelField?.help;
  const pickAgent = (id: string) => {
    const next = agents.find((a) => a.id === id);
    set({ agentId: next ? next.id : null, agentLabel: next?.label, model: null });
  };
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
                From <span className="mono">{skillFolders.map((f) => `${f}/`).join(', ')}</span> on main.
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
        <Field label="With agent" help={agentHelp}>
          {({ id, describedBy }) => (
            <Select
              id={id}
              aria-describedby={describedBy}
              disabled={agentLocked || agentsState === 'loading'}
              value={value.agentId ?? ''}
              onChange={(e) => pickAgent(e.target.value)}
            >
              {agentLocked || agentsState === 'loading' ? (
                <>
                  <option value={value.agentId ?? ''}>
                    {value.agentId === null ? projectDefaultLabel(defaultAgentName) : currentName}
                  </option>
                  {agentsState === 'loading' && (
                    <option value="__loading" disabled>
                      Loading agents…
                    </option>
                  )}
                </>
              ) : (
                <>
                  <option value="">{projectDefaultLabel(defaultAgentName)}</option>
                  {gone && <option value={value.agentId ?? ''}>{currentName} (unavailable)</option>}
                  {agents.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.label}
                    </option>
                  ))}
                </>
              )}
            </Select>
          )}
        </Field>
        {modelField && (
          <ModelPicker
            label="Model"
            withDefault
            list={modelField.list}
            // null follows the default model; '' is Other model… with nothing typed yet and is not saveable.
            value={value.model ?? null}
            onChange={(model) => set({ model })}
            help={modelHelp}
            error={errors?.model}
          />
        )}
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
