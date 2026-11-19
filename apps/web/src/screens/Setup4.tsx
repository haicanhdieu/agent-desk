import { useState } from 'react';
import { Banner, Icon } from '@/ds';
import {
  FollowUpRule,
  GuardsCard,
  RuleForm,
  SetupLayout,
  type ModelList,
  type RuleDraft,
  type PromptPreview,
  type RuleFormProps,
  type RuleTarget,
} from '@/components';
import type { Actor } from '@/mocks/types';
import { DEFAULT_CREDENTIAL_DETAIL, setupSteps, type SetupNav } from './setupSteps';

export interface Setup4Props extends SetupNav {
  user: Actor;
  projectName: string;
  repo: string;
  rule: RuleDraft;
  skills: string[];
  followUp: { command: string; target: RuleTarget; skill: string; enabled: boolean };
  maxRunsPerTicket: number;
  /** The Model field's list; without it the field is hidden. */
  modelList?: ModelList;
  credentialDetail?: string;
  agentSettingsHref?: string;
  ignoredHref?: string;
  /** Saves the rules. With it, the primary button is a button instead of the `nextHref` link. */
  onContinue?(draft: { rule: RuleDraft; followUp: boolean }): void;
  saving?: boolean;
  /** Field messages for the first rule. */
  errors?: RuleFormProps['errors'];
  /** A failed save that names no field of the first rule. */
  formError?: string;
  /** System lines for custom prompt rules; with it the first rule can be a skill or a custom prompt. */
  promptPreview?: PromptPreview;
}

export function Setup4({
  user,
  projectName,
  repo,
  rule,
  skills,
  followUp,
  maxRunsPerTicket,
  modelList,
  credentialDetail = DEFAULT_CREDENTIAL_DETAIL,
  backHref = '#',
  nextHref = '#',
  agentSettingsHref = '#',
  ignoredHref = '#',
  onContinue,
  saving,
  errors,
  formError,
  promptPreview,
}: Setup4Props) {
  const [draft, setDraft] = useState(rule);
  const [follow, setFollow] = useState(followUp.enabled);
  return (
    <SetupLayout
      user={user}
      projectName={projectName}
      steps={setupSteps({ repo, credential: credentialDetail, skills: skills.join(', '), withWorkspace: true })}
      current={4}
      stepLabel="Step 5 of 5"
      title="Add your first rule"
      intro="A rule turns a comment command into a run. We filled in the one most people start with."
      footer={{
        back: backHref,
        next: onContinue
          ? {
              label: 'Save rules and finish',
              onClick: () => onContinue({ rule: draft, followUp: follow }),
              pending: saving,
            }
          : { label: 'Save rules and finish', href: nextHref },
      }}
      aside={
        <GuardsCard maxRunsPerTicket={maxRunsPerTicket} changeHref={agentSettingsHref} ignoredHref={ignoredHref} />
      }
    >
      {formError && <Banner tone="err" icon={<Icon name="warning" size={16} />} title={formError} live="assertive" />}
      <RuleForm
        value={draft}
        skills={skills}
        agents={[draft.agent]}
        modelField={modelList && { list: modelList, help: 'Default model is the one picked in step 2.' }}
        agentLocked
        spacious
        onChange={setDraft}
        errors={errors}
        promptPreview={promptPreview}
      />
      <FollowUpRule
        command={followUp.command}
        target={followUp.target}
        skill={followUp.skill}
        enabled={follow}
        onChange={setFollow}
      />
    </SetupLayout>
  );
}
