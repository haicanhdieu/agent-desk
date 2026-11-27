import { useState } from 'react';
import { Banner, Icon } from '@/ds';
import { CommitSummary, SetupLayout, SkillTemplateCard, SkillTemplatePreview } from '@/components';
import type { Actor, SkillTemplate } from '@/mocks/types';
import type { OrgSwitchProps } from '@/components';
import { DEFAULT_CREDENTIAL_DETAIL, commitLabel, setupSteps, type SetupNav } from './setupSteps';
import styles from './Screens.module.css';

export interface Setup3Props extends SetupNav {
  user: Actor;
  /** The org crumb and menu in the top bar. */
  org?: OrgSwitchProps;
  projectName: string;
  repo: string;
  branch: string;
  /** The cards, each with the SKILL.md text its Preview dialog shows (bundled; nothing is fetched). */
  templates: readonly (SkillTemplate & { body: string })[];
  selected: string[];
  commitMessage: string;
  credentialDetail?: string;
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
  org,
  projectName,
  exitHref,
  repo,
  branch,
  templates,
  selected,
  commitMessage,
  credentialDetail = DEFAULT_CREDENTIAL_DETAIL,
  backHref = '#',
  skipHref = '#',
  nextHref = '#',
  onContinue,
  onSkip,
  saving,
  errors,
  formError,
}: Setup3Props) {
  const [picked, setPicked] = useState(selected);
  const [edited, setEdited] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState<string | null>(null);
  const previewed = templates.find((t) => t.name === previewing);
  const names = templates.map((t) => t.name).filter((n) => picked.includes(n));
  const unchanged = names.length === selected.length && names.every((n) => selected.includes(n));
  const message = edited ?? (unchanged ? commitMessage : `Add Agent Desk skills: ${names.join(', ')}`);
  const toggle = (name: string, on: boolean) => setPicked((p) => (on ? [...p, name] : p.filter((n) => n !== name)));
  return (
    <SetupLayout
      user={user}
      org={org}
      projectName={projectName}
      exitHref={exitHref}
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
            onPreview={() => setPreviewing(t.name)}
          />
        ))}
      </div>
      {previewed && (
        <SkillTemplatePreview name={previewed.name} body={previewed.body} onClose={() => setPreviewing(null)} />
      )}
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
