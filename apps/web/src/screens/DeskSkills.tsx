import { useState } from 'react';
import { Button, CommandChip, IconButton, LabelChip, SegmentedControl } from '@/ds';
import { CodeEditor, CommitBar, ConfirmDeleteDialog, EmptyState, SkillList } from '@/components';
import type { Skill } from '@/mocks/types';
import styles from './Screens.module.css';
import { DeskFrame, type DeskFrameData } from './DeskFrame';

type View = 'edit' | 'preview' | 'diff';

export interface DeskSkillsProps {
  /** Top bar and Desk navigation data. */
  frame: DeskFrameData;
  skills: Skill[];
  activeName?: string;
  dirty?: boolean;
  /** 1-based lines marked as changed in the editor. */
  changedLines?: number[];
  view?: View;
  /** Name of the skill whose delete confirmation is open. */
  deleting?: string;
  /** Rule commands (e.g. "/code-e2e") that use the skill being deleted. */
  rulesUsing?: string[];
  commitMessage?: string;
  /** In-app href of a skill in the list; defaults to `#<name>`. */
  skillHref?(name: string): string;
  /** A skill was picked in the list (the link's own navigation is skipped). */
  onSelect?(name: string): void;
  onDelete?(name: string): void;
  onCloseDelete?(): void;
  onConfirmDelete?(message: string): void;
  /** Commit the editor's text with the message. */
  onCommit?(body: string, message: string): void;
}

const views: { value: View; label: string }[] = [
  { value: 'edit', label: 'Edit' },
  { value: 'preview', label: 'Preview' },
  { value: 'diff', label: 'Diff' },
];

/** The editor column for one skill. Keyed by skill name so the draft and view reset when the skill changes. */
function SkillEditor({
  skill, dirty: markedDirty, changedLines, view: initialView, commitMessage, onDelete, onCommit,
}: {
  skill: Skill; dirty: boolean; changedLines: number[]; view: View; commitMessage: string;
  onDelete?(name: string): void; onCommit?(body: string, message: string): void;
}) {
  const [view, setView] = useState<View>(initialView);
  const [value, setValue] = useState(skill.body);
  const [message, setMessage] = useState(commitMessage);
  // Dirty when marked so (stories) or when the text differs from the skill as last loaded.
  const dirty = markedDirty || value !== skill.body;
  const [hash, ago] = skill.lastCommit.split(/,\s*(.*)/);
  return (
    <>
      <div className={styles.skillHead}>
        <div className={styles.skillHeadText}>
          <span className={styles.skillTitleRow}>
            <h2 className={`mono ${styles.skillTitle}`} title={skill.name}>{skill.name}</h2>
            {dirty && <LabelChip name="Unsaved changes" tone="idle" />}
          </span>
          <span className={`faint ${styles.skillMeta}`}>
            <span className="mono">{skill.path}</span>
            {hash && <>, last commit <span className="mono">{hash}</span>{ago && <>, {ago}</>}</>}
          </span>
        </div>
        <SegmentedControl aria-label="Editor view" value={view} options={views} onChange={(v) => setView(v as View)} />
        <Button variant="ghost" size="sm" icon="external" href="https://github.com/">History</Button>
        <IconButton icon="trash" aria-label="Delete skill" onClick={() => onDelete?.(skill.name)} />
      </div>
      <CodeEditor
        aria-label="SKILL.md source"
        value={value}
        onChange={setValue}
        readOnly={view !== 'edit'}
        changedLines={view === 'preview' ? [] : changedLines}
      />
      <CommitBar
        message={message}
        onMessageChange={setMessage}
        branch="main"
        dirty={dirty}
        onDiscard={() => setValue(skill.body)}
        onCommit={() => onCommit?.(value, message)}
        note="Commits as agent-desk[bot]. Runs that start after the commit use the new version; running runs keep the old one."
      />
    </>
  );
}

export function DeskSkills({
  frame, skills, activeName, dirty = false, changedLines = [], view = 'edit', deleting, rulesUsing = [],
  commitMessage = '', skillHref, onSelect, onDelete, onCloseDelete, onConfirmDelete, onCommit,
}: DeskSkillsProps) {
  const active = skills.find((s) => s.name === activeName) ?? skills[0];
  const doomed = deleting ? skills.find((s) => s.name === deleting) : undefined;
  return (
    <>
      <DeskFrame active="skills" {...frame}>
        <div className={styles.deskRow}>
          <SkillList
            branch="main"
            activeName={active?.name}
            skills={skills.map((s) => ({
              name: s.name, description: s.description, ruleSummary: s.ruleSummary,
              ...(skillHref && { href: skillHref(s.name) }),
            }))}
            onSelect={onSelect}
          />
          <main className={styles.skillsMain}>
            {active ? (
              <SkillEditor
                key={active.name}
                skill={active}
                dirty={dirty}
                changedLines={changedLines}
                view={view}
                commitMessage={commitMessage}
                onDelete={onDelete}
                onCommit={onCommit}
              />
            ) : (
              <EmptyState
                title="No skills yet"
                body={<>A skill is a <span className="mono">SKILL.md</span> file under <span className="mono">.claude/skills/</span>. Start from one of the starter templates, or create a skill from scratch.</>}
                action={<Button variant="primary" icon="plus">New skill</Button>}
              />
            )}
          </main>
        </div>
      </DeskFrame>
      {doomed && (
        <ConfirmDeleteDialog
          open
          name={doomed.name}
          path={`.claude/skills/${doomed.name}/`}
          branch="main"
          defaultMessage={`Remove ${doomed.name} skill`}
          warning={rulesUsing.length > 0 ? (
            <>
              {rulesUsing.length === 1 ? 'Rule' : 'Rules'}{' '}
              {rulesUsing.map((c, i) => <span key={c}>{i > 0 && ', '}<CommandChip>{c}</CommandChip></span>)}{' '}
              {rulesUsing.length === 1 ? 'uses' : 'use'} this skill. {rulesUsing.length === 1 ? 'It' : 'They'} will be disabled, and comments with {rulesUsing.length === 1 ? 'that command' : 'those commands'} will show as ignored.
            </>
          ) : undefined}
          onClose={() => onCloseDelete?.()}
          onConfirm={(m) => onConfirmDelete?.(m)}
        />
      )}
    </>
  );
}
