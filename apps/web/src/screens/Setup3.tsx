import { useState } from 'react';
import { Banner, Icon } from '@/ds';
import { CommitSummary, SetupLayout, SkillTemplateCard } from '@/components';
import type { Actor, SkillTemplate } from '@/mocks/types';
import { DEFAULT_CREDENTIAL_DETAIL, commitLabel, setupSteps, type SetupNav } from './setupSteps';
import styles from './Screens.module.css';

export interface Setup3Props extends SetupNav {
  user: Actor;
  projectName: string;
  repo: string;
  branch: string;
  templates: SkillTemplate[];
  selected: string[];
  commitMessage: string;
  credentialDetail?: string;
  previewHref?: string;
  /** Commits the picked templates. With it, the primary button is a button instead of the `nextHref` link. */
  onContinue?(draft: { names: string[]; message: string }): void;
  /** Skips the step (it is still saved as done). With it, Skip is a button. */
  onSkip?(): void;
  saving?: boolean;
  errors?: { message?: string };
  /** A failed save that names no field. */
  formError?: string;
}

export function Setup3({
  user,
  projectName,
  repo,
  branch,
  templates,
  selected,
  commitMessage,
  credentialDetail = DEFAULT_CREDENTIAL_DETAIL,
  backHref = '#',
  skipHref = '#',
  nextHref = '#',
  previewHref = '#',
  onContinue,
  onSkip,
  saving,
  errors,
  formError,
}: Setup3Props) {
  const [picked, setPicked] = useState(selected);
  const [edited, setEdited] = useState<string | null>(null);
  const names = templates.map((t) => t.name).filter((n) => picked.includes(n));
  const unchanged = names.length === selected.length && names.every((n) => selected.includes(n));
  const message = edited ?? (unchanged ? commitMessage : `Add Agent Desk skills: ${names.join(', ')}`);
  const toggle = (name: string, on: boolean) => setPicked((p) => (on ? [...p, name] : p.filter((n) => n !== name)));
  return (
    <SetupLayout
      user={user}
      projectName={projectName}
      steps={setupSteps({ repo, credential: credentialDetail, withWorkspace: true })}
      current={3}
      stepLabel="Step 4 of 5, optional"
      title="Start from skill templates"
      intro={
        <>
          A skill is a Markdown file in your repo at <span className="mono">.claude/skills/&lt;name&gt;/SKILL.md</span>.
          Pick templates to add them, or skip if your repo already has skills.
        </>
      }
      footer={{
        back: backHref,
        skip: skipHref,
        onSkip,
        next: onContinue
          ? { label: commitLabel(names.length), onClick: () => onContinue({ names, message }), pending: saving }
          : { label: commitLabel(names.length), href: nextHref },
      }}
    >
      {formError && <Banner tone="err" icon={<Icon name="warning" size={16} />} title={formError} live="assertive" />}
      <Banner tone="off" icon={<Icon name="info" size={16} />}>
        <span className={styles.onText}>
          No skills found in <span className="mono">{repo}</span> on <span className="mono">{branch}</span>.
        </span>
      </Banner>
      <div className={styles.stack8}>
        {templates.map((t) => (
          <SkillTemplateCard
            key={t.name}
            template={t}
            checked={picked.includes(t.name)}
            onChange={(on) => toggle(t.name, on)}
            previewHref={previewHref}
          />
        ))}
      </div>
      {names.length > 0 && (
        <CommitSummary
          branch={branch}
          author="agent-desk[bot]"
          message={message}
          files={names.map((n) => `.claude/skills/${n}/SKILL.md`)}
          onMessageChange={setEdited}
          error={errors?.message}
        />
      )}
    </SetupLayout>
  );
}
