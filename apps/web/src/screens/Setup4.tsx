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
import type { OrgSwitchProps } from '@/components';
import { DEFAULT_CREDENTIAL_DETAIL, setupSteps, type SetupNav } from './setupSteps';

export interface Setup4Props extends SetupNav {
  user: Actor;
  /** The org crumb and menu in the top bar. */
  org?: OrgSwitchProps;
  projectName: string;
  repo: string;
  rule: RuleDraft;
  skills: string[];
  followUp: { command: string; target: RuleTarget; skill: string; enabled: boolean };
  maxRunsPerTicket: number;
  /** The Model field's list; without it the field is hidden. */
  modelList?: ModelList;
  credentialDetail?: string;
  /** The project default agent's name: the locked agent field then reads "Project default (<name>)". */
  defaultAgentName?: string;
  agentSettingsHref?: string;
  ignoredHref?: string;
  /** Saves the rules. With it, the primary button is a button instead of the `nextHref` link. */
  onContinue?(draft: { rule: RuleDraft; followUp: boolean }): void;
  /** Skips the rule and finishes setup. With it, Skip is a button instead of the `skipHref` link. */
  onSkip?(): void;
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
  org,
  projectName,
  repo,
  rule,
  skills,
  followUp,
  maxRunsPerTicket,
  modelList,
  credentialDetail = DEFAULT_CREDENTIAL_DETAIL,
  defaultAgentName,
  backHref = '#',
  nextHref = '#',
  agentSettingsHref = '#',
  ignoredHref = '#',
  skipHref = '#',
  onContinue,
  onSkip,
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
      org={org}
      projectName={projectName}
      steps={setupSteps({ repo, credential: credentialDetail, skills: skills.join(', '), withWorkspace: true })}
      current={4}
      stepLabel="Step 5 of 5, optional"
      title="Add your first rule"
      intro="A rule turns a comment command into a run. We filled in the one most people start with."
      footer={{
        back: backHref,
        skip: skipHref,
        onSkip,
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
        value={defaultAgentName === undefined ? draft : { ...draft, agentId: null, agentLabel: undefined }}
        skills={skills}
        defaultAgentName={defaultAgentName}
        agents={
          draft.agentId
            ? [
                {
                  id: draft.agentId,
                  label: draft.agentLabel ?? draft.agentId,
                  provider: 'claude',
                  needsCredential: true,
                },
              ]
            : []
        }
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
