import { useState } from 'react';
import { Button } from '@/ds';
import { EmptyState, GuardsCard, RuleForm, RuleRow, SidePane, type RuleDraft } from '@/components';
import type { Rule } from '@/mocks/types';
import styles from './Screens.module.css';
import { DeskFrame, type DeskFrameData } from './DeskFrame';

export interface DeskRulesProps {
  /** Top bar and Desk navigation data. */
  frame: DeskFrameData;
  rules: Rule[];
  /** Skill names offered in the rule form. */
  skills: string[];
  editingId?: string;
  maxRunsPerTicket: number;
  onToggle?(id: string, next: boolean): void;
  onNew?(): void;
  onEdit?(id: string): void;
  onMore?(id: string): void;
  onClose?(): void;
  onSave?(id: string, draft: RuleDraft): void;
  onDelete?(id: string): void;
}

/** Owns the draft while a rule is open; keyed by rule id so switching rules starts from the saved values. */
function RulePane({
  rule, skills, onClose, onSave, onDelete,
}: { rule: Rule; skills: string[]; onClose(): void; onSave?(draft: RuleDraft): void; onDelete?(): void }) {
  const [draft, setDraft] = useState<RuleDraft>({
    command: rule.command, target: rule.target, labels: rule.labels, skill: rule.skill, agent: rule.agent, enabled: rule.enabled,
  });
  return (
    <SidePane
      title="Edit rule"
      onClose={onClose}
      footer={(
        <div className={styles.paneFootStack}>
          <div className={styles.paneActions}>
            <Button variant="danger" icon="trash" onClick={onDelete}>Delete rule</Button>
            <span className={styles.grow} />
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button variant="primary" onClick={() => onSave?.(draft)}>Save rule</Button>
          </div>
          <p className={`faint ${styles.helpLine}`}>Saving does not touch the repo. Rules apply to comments posted after you save.</p>
        </div>
      )}
    >
      <RuleForm value={draft} skills={skills} agents={['Claude']} agentLocked agentModel="opus" onChange={setDraft} />
    </SidePane>
  );
}

export function DeskRules({
  frame, rules, skills, editingId, maxRunsPerTicket, onToggle, onNew, onEdit, onMore, onClose, onSave, onDelete,
}: DeskRulesProps) {
  const editing = rules.find((r) => r.id === editingId);
  return (
    <DeskFrame active="rules" {...frame}>
      <main className={styles.rulesMain}>
        <div className={styles.rulesCol}>
          <div className={styles.split}>
            <div className={styles.stack6}>
              <h1>Routing rules</h1>
              <p className={`muted ${styles.helpLine13}`}>A comment whose first line is a command starts a run when it matches a rule. One rule per command.</p>
            </div>
            <Button variant="primary" icon="plus" onClick={onNew}>New rule</Button>
          </div>
          {rules.length === 0 ? (
            <EmptyState
              title="No routing rules yet"
              body="A rule maps a command in a comment, like /code-build, to a skill. Add one to let comments start runs."
              action={<Button variant="primary" icon="plus" onClick={onNew}>New rule</Button>}
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
          <GuardsCard maxRunsPerTicket={maxRunsPerTicket} changeHref="/desk/agent" ignoredHref="/runs" />
        </div>
        {editing && (
          <RulePane
            key={editing.id}
            rule={editing}
            skills={skills}
            onClose={() => onClose?.()}
            onSave={(d) => onSave?.(editing.id, d)}
            onDelete={() => onDelete?.(editing.id)}
          />
        )}
      </main>
    </DeskFrame>
  );
}
