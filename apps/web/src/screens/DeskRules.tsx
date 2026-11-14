import { useState, type ReactNode } from 'react';
import { Banner, Button, Icon } from '@/ds';
import { EmptyState, GuardsCard, RuleForm, RuleRow, SidePane, type RuleDraft, type RuleFormProps } from '@/components';
import type { Rule } from '@/mocks/types';
import styles from './Screens.module.css';
import { DeskFrame, type DeskFrameData } from './DeskFrame';

export interface DeskRulesProps {
  /** Top bar and Desk navigation data. */
  frame: DeskFrameData;
  rules: Rule[];
  /** Skill names offered in the rule form. */
  skills: string[];
  /** The selected rule (row marked current). Without `form`, its pane opens with a local draft. */
  editingId?: string;
  maxRunsPerTicket: number;
  /** In-app links of the guards card ("Change" the limit, "Runs, Ignored"). */
  guardLinks?: { change?: string; ignored?: string };
  /** The open rule form (a `RulePane` driven by the app); replaces the local edit pane. */
  form?: ReactNode;
  onToggle?(id: string, enabled: boolean): void;
  onCreate?(): void;
  onEdit?(id: string): void;
  onMore?(id: string): void;
  onClose?(): void;
  onSave?(id: string, draft: RuleDraft): void;
  onDelete?(id: string): void;
}

export interface RulePaneProps {
  title: 'Edit rule' | 'New rule';
  value: RuleDraft;
  skills: string[];
  agentModel?: string;
  onChange(draft: RuleDraft): void;
  onClose(): void;
  onSave(): void;
  /** Shows "Delete rule" (an existing rule only). */
  onDelete?(): void;
  errors?: RuleFormProps['errors'];
  /** A failed save that names no field. */
  formError?: string;
  saving?: boolean;
}

/** The rule side pane: the rule form with Delete, Cancel and Save. Controlled: the caller owns the draft. */
export function RulePane({
  title,
  value,
  skills,
  agentModel = 'opus',
  onChange,
  onClose,
  onSave,
  onDelete,
  errors,
  formError,
  saving,
}: RulePaneProps) {
  return (
    <SidePane
      title={title}
      onClose={onClose}
      footer={
        <div className={styles.paneFootStack}>
          <div className={styles.paneActions}>
            {onDelete && (
              <Button variant="danger" icon="trash" onClick={onDelete}>
                Delete rule
              </Button>
            )}
            <span className={styles.grow} />
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" disabled={saving} aria-busy={saving || undefined} onClick={onSave}>
              Save rule
            </Button>
          </div>
          <p className={`faint ${styles.helpLine}`}>
            Saving does not touch the repo. Rules apply to comments posted after you save.
          </p>
        </div>
      }
    >
      {formError && <Banner tone="err" icon={<Icon name="warning" size={16} />} title={formError} live="assertive" />}
      <RuleForm
        value={value}
        skills={skills}
        agents={[value.agent]}
        agentLocked
        agentModel={agentModel}
        onChange={onChange}
        errors={errors}
      />
    </SidePane>
  );
}

/** Owns the draft while a rule is open (no `form` slot); keyed by rule id so switching rules starts from the saved values. */
function LocalRulePane({
  rule,
  skills,
  onClose,
  onSave,
  onDelete,
}: {
  rule: Rule;
  skills: string[];
  onClose(): void;
  onSave?(draft: RuleDraft): void;
  onDelete?(): void;
}) {
  const [draft, setDraft] = useState<RuleDraft>({
    command: rule.command,
    target: rule.target,
    labels: rule.labels,
    skill: rule.skill,
    agent: rule.agent,
    enabled: rule.enabled,
  });
  return (
    <RulePane
      title="Edit rule"
      value={draft}
      skills={skills}
      onChange={setDraft}
      onClose={onClose}
      onSave={() => onSave?.(draft)}
      onDelete={() => onDelete?.()}
    />
  );
}

export function DeskRules({
  frame,
  rules,
  skills,
  editingId,
  maxRunsPerTicket,
  guardLinks,
  form,
  onToggle,
  onCreate,
  onEdit,
  onMore,
  onClose,
  onSave,
  onDelete,
}: DeskRulesProps) {
  const editing = rules.find((r) => r.id === editingId);
  return (
    <DeskFrame active="rules" {...frame}>
      <main className={styles.rulesMain}>
        <div className={styles.rulesCol}>
          <div className={styles.split}>
            <div className={styles.stack6}>
              <h1>Routing rules</h1>
              <p className={`muted ${styles.helpLine13}`}>
                A comment whose first line is a command starts a run when it matches a rule. One rule per command.
              </p>
            </div>
            <Button variant="primary" icon="plus" onClick={onCreate}>
              New rule
            </Button>
          </div>
          {rules.length === 0 ? (
            <EmptyState
              title="No routing rules yet"
              body="A rule maps a command in a comment, like /code-build, to a skill. Add one to let comments start runs."
              action={
                <Button variant="primary" icon="plus" onClick={onCreate}>
                  New rule
                </Button>
              }
            />
          ) : (
            <div className={styles.ruleList}>
              {rules.map((r) => (
                <RuleRow
                  key={r.id}
                  rule={r}
                  stats={r.stats}
                  warning={r.warning}
                  selected={r.id === editingId}
                  onToggle={(next) => onToggle?.(r.id, next)}
                  onSelect={() => onEdit?.(r.id)}
                  onMore={() => onMore?.(r.id)}
                />
              ))}
            </div>
          )}
          <GuardsCard
            maxRunsPerTicket={maxRunsPerTicket}
            changeHref={guardLinks?.change ?? '/desk/agent'}
            ignoredHref={guardLinks?.ignored ?? '/runs'}
          />
        </div>
        {form ??
          (editing && (
            <LocalRulePane
              key={editing.id}
              rule={editing}
              skills={skills}
              onClose={() => onClose?.()}
              onSave={(d) => onSave?.(editing.id, d)}
              onDelete={() => onDelete?.(editing.id)}
            />
          ))}
      </main>
    </DeskFrame>
  );
}
