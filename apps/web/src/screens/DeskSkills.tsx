import { useState } from 'react';
import { Banner, Button, CommandChip, IconButton, LabelChip, SegmentedControl } from '@/ds';
import {
  AppShell,
  CodeEditor,
  CommitBar,
  ConfirmDeleteDialog,
  EmptyState,
  Pagination,
  SkillDiff,
  SkillList,
  SkillPreviewPane,
  type SkillPreviewPaneProps,
  type PaginationProps,
} from '@/components';
import type { Skill } from '@/mocks/types';
import styles from './Screens.module.css';
import { DeskFrame, type DeskFrameData } from './DeskFrame';

type View = 'edit' | 'preview' | 'diff';

/** A skill change that was submitted for review (a pending change request), not merged. */
export interface SkillSubmission {
  /** 'save' for a create or edit, 'delete' for a removal. */
  action: 'save' | 'delete';
  sourceBranch: string;
  targetBranch: string;
  /** Where the change request is; untrusted, drawn as a link only when it is http(s). */
  url: string;
}

const isWebUrl = (url: string) => /^https?:\/\//i.test(url);

export interface DeskSkillsProps {
  /** Top bar and Desk navigation data. */
  frame: DeskFrameData;
  /** `'viewport'` fits the page to the window (the app route): the page does not scroll, each of the three columns does. */
  height?: 'viewport';
  skills: Skill[];
  activeName?: string;
  /** The editor's skill. Defaults to the one named `activeName` in `skills`, else the first; pass it when the list is a page that may not hold it. */
  active?: Skill;
  /** The paging control under the skill list; not drawn without skills. */
  pagination?: PaginationProps;
  dirty?: boolean;
  /** 1-based lines marked as changed in the editor. */
  changedLines?: number[];
  view?: View;
  /** Story-only: the draft starts from this text instead of the skill's body. */
  initialDraft?: string;
  /** Story-only: loaders for the Preview view. The defaults load the real modules. */
  preview?: Pick<SkillPreviewPaneProps, 'load' | 'loadMermaid'>;
  /** Name of the skill whose delete confirmation is open. */
  deleting?: string;
  /** Rule commands (e.g. "/code-e2e") that use the skill being deleted. */
  rulesUsing?: string[];
  commitMessage?: string;
  /** The repo folders searched for skills, in order; defaults to `.claude/skills` (stories). */
  folders?: string[];
  /** The project's default branch, where changes land. Null when it is not known; defaults to `main` (stories). */
  defaultBranch?: string | null;
  /** A submission is in flight (Submit changes disabled). */
  committing?: boolean;
  /** The delete request is in flight (the dialog's confirm disabled). */
  deletePending?: boolean;
  /** The last change submitted for review, shown above the editor until dismissed. */
  submission?: SkillSubmission;
  onDismissSubmission?(): void;
  /**
   * Identity of the editor's draft. When it changes the draft starts over from the skill's current body (e.g. after
   * a rejected commit). Defaults to the skill name.
   */
  editorKey?: string;
  /** In-app href of a skill in the list; defaults to `#<name>`. */
  skillHref?(name: string): string;
  /** A skill was picked in the list (the link's own navigation is skipped). */
  onSelect?(name: string): void;
  onDelete?(name: string): void;
  onCloseDelete?(): void;
  onConfirmDelete?(message: string): void;
  /** Submit the editor's text with the message. */
  onCommit?(body: string, message: string): void;
  /** The draft was discarded: the host may start a new draft from the skill's latest body. */
  onDiscard?(): void;
}

const views: { value: View; label: string }[] = [
  { value: 'edit', label: 'Edit' },
  { value: 'preview', label: 'Preview' },
  { value: 'diff', label: 'Diff' },
];

/** The editor column for one skill. Keyed by `editorKey` (default: the skill name), so the draft and view reset when it changes. */
function SkillEditor({
  skill,
  dirty: markedDirty,
  changedLines,
  view: initialView,
  initialDraft,
  preview,
  commitMessage,
  committing,
  branch,
  onDelete,
  onCommit,
  onDiscard,
}: {
  skill: Skill;
  dirty: boolean;
  changedLines: number[];
  view: View;
  initialDraft?: string;
  preview?: DeskSkillsProps['preview'];
  commitMessage: string;
  committing: boolean;
  branch: string | null;
  onDelete?(name: string): void;
  onCommit?(body: string, message: string): void;
  onDiscard?(): void;
}) {
  const [view, setView] = useState<View>(initialView);
  const [value, setValue] = useState(initialDraft ?? skill.body);
  const [message, setMessage] = useState(commitMessage);
  // Dirty when marked so (stories) or when the text differs from the skill as last loaded.
  const dirty = markedDirty || value !== skill.body;
  const [hash, ago] = skill.lastCommit.split(/,\s*(.*)/);
  return (
    <>
      <div className={styles.skillHead}>
        <div className={styles.skillHeadText}>
          <span className={styles.skillTitleRow}>
            <h2 className={`mono ${styles.skillTitle}`} title={skill.name}>
              {skill.name}
            </h2>
            {dirty && <LabelChip name="Unsaved changes" tone="idle" />}
          </span>
          <span className={`faint ${styles.skillMeta}`}>
            <span className="mono">{skill.path}</span>
            {hash && (
              <>
                , last commit <span className="mono">{hash}</span>
                {ago && <>, {ago}</>}
              </>
            )}
          </span>
        </div>
        <SegmentedControl aria-label="Editor view" value={view} options={views} onChange={(v) => setView(v as View)} />
        <Button variant="ghost" size="sm" icon="external" href="https://github.com/">
          History
        </Button>
        <IconButton icon="trash" aria-label="Delete skill" onClick={() => onDelete?.(skill.name)} />
      </div>
      {view === 'edit' && (
        <CodeEditor aria-label="SKILL.md source" value={value} onChange={setValue} changedLines={changedLines} />
      )}
      {view === 'preview' && <SkillPreviewPane value={value} {...preview} />}
      {view === 'diff' && <SkillDiff base={skill.body} draft={value} />}
      <CommitBar
        message={message}
        onMessageChange={setMessage}
        branch={branch}
        dirty={dirty}
        pending={committing}
        onDiscard={() => {
          setValue(skill.body);
          onDiscard?.();
        }}
        onCommit={() => onCommit?.(value, message)}
        note="Submitted as agent-desk[bot]. If the target branch requires review, the changes are submitted for review instead of saved."
      />
    </>
  );
}

function SubmissionNotice({ submission, onDismiss }: { submission: SkillSubmission; onDismiss?(): void }) {
  const deletion = submission.action === 'delete';
  return (
    <Banner
      tone="ok"
      live="polite"
      title={deletion ? 'Deletion submitted for review' : 'Changes submitted for review'}
      actions={
        <>
          {isWebUrl(submission.url) && (
            <Button
              variant="primary"
              size="sm"
              icon="external"
              href={submission.url}
              target="_blank"
              rel="noopener noreferrer"
            >
              View change request
            </Button>
          )}
          {onDismiss && (
            <Button variant="ghost" size="sm" onClick={onDismiss}>
              Dismiss
            </Button>
          )}
        </>
      }
    >
      <span className="mono">
        {submission.sourceBranch} → {submission.targetBranch}
      </span>
      . It is not merged yet:{' '}
      {deletion
        ? `the skill stays on ${submission.targetBranch} until it is.`
        : `${submission.targetBranch} keeps the current version until it is.`}
    </Banner>
  );
}

export function DeskSkills({
  frame,
  height,
  skills,
  activeName,
  active: activeSkill,
  pagination,
  dirty = false,
  changedLines = [],
  view = 'edit',
  initialDraft,
  preview,
  deleting,
  rulesUsing = [],
  commitMessage = '',
  folders = ['.claude/skills'],
  defaultBranch = 'main',
  committing = false,
  deletePending = false,
  submission,
  onDismissSubmission,
  editorKey,
  skillHref,
  onSelect,
  onDelete,
  onCloseDelete,
  onConfirmDelete,
  onCommit,
  onDiscard,
}: DeskSkillsProps) {
  const active = activeSkill ?? skills.find((s) => s.name === activeName) ?? skills[0];
  const branchLabel = defaultBranch ?? 'the default branch';
  const doomed = deleting ? skills.find((s) => s.name === deleting) : undefined;
  const page = (
    <>
      <DeskFrame active="skills" {...frame}>
        <div className={styles.deskRow}>
          <SkillList
            branch={branchLabel}
            folders={folders}
            activeName={active?.name}
            skills={skills.map((s) => ({
              name: s.name,
              description: s.description,
              ruleSummary: s.ruleSummary,
              ...(skillHref && { href: skillHref(s.name) }),
            }))}
            onSelect={onSelect}
            footer={skills.length > 0 && pagination ? <Pagination {...pagination} /> : undefined}
          />
          <main className={styles.skillsMain}>
            {submission && <SubmissionNotice submission={submission} onDismiss={onDismissSubmission} />}
            {active ? (
              <SkillEditor
                key={editorKey ?? active.name}
                skill={active}
                dirty={dirty}
                changedLines={changedLines}
                view={view}
                initialDraft={initialDraft}
                preview={preview}
                commitMessage={commitMessage}
                committing={committing}
                branch={defaultBranch}
                onDelete={onDelete}
                onCommit={onCommit}
                onDiscard={onDiscard}
              />
            ) : (
              <EmptyState
                title="No skills yet"
                body={
                  <>
                    A skill is a <span className="mono">SKILL.md</span> file under{' '}
                    <span className="mono">{folders.map((f) => `${f}/`).join(' or ')}</span>. Start from one of the
                    starter templates, or create a skill from scratch.
                  </>
                }
                action={
                  <Button variant="primary" icon="plus">
                    New skill
                  </Button>
                }
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
          branch={branchLabel}
          pending={deletePending}
          defaultMessage={`Remove ${doomed.name} skill`}
          warning={
            rulesUsing.length > 0 ? (
              <>
                {rulesUsing.length === 1 ? 'Rule' : 'Rules'}{' '}
                {rulesUsing.map((c, i) => (
                  <span key={c}>
                    {i > 0 && ', '}
                    <CommandChip>{c}</CommandChip>
                  </span>
                ))}{' '}
                {rulesUsing.length === 1 ? 'uses' : 'use'} this skill. {rulesUsing.length === 1 ? 'It' : 'They'} will be
                disabled, and comments with {rulesUsing.length === 1 ? 'that command' : 'those commands'} will show as
                ignored.
              </>
            ) : undefined
          }
          onClose={() => onCloseDelete?.()}
          onConfirm={(m) => onConfirmDelete?.(m)}
        />
      )}
    </>
  );
  return height === 'viewport' ? (
    <AppShell height="viewport" topBar={null}>
      {page}
    </AppShell>
  ) : (
    page
  );
}
