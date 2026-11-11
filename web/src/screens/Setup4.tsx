import { useState } from 'react';
import { FollowUpRule, GuardsCard, RuleForm, SetupLayout, type RuleDraft, type RuleTarget } from '@/components';
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
  agentModel?: string;
  credentialDetail?: string;
  agentSettingsHref?: string;
  ignoredHref?: string;
}

export function Setup4({
  user, projectName, repo, rule, skills, followUp, maxRunsPerTicket, agentModel = 'opus', credentialDetail = DEFAULT_CREDENTIAL_DETAIL,
  backHref = '#', nextHref = '#', agentSettingsHref = '#', ignoredHref = '#',
}: Setup4Props) {
  const [draft, setDraft] = useState(rule);
  const [follow, setFollow] = useState(followUp.enabled);
  return (
    <SetupLayout
      user={user}
      projectName={projectName}
      steps={setupSteps({ repo, credential: credentialDetail, skills: skills.join(', ') })}
      current={3}
      stepLabel="Step 4 of 4"
      title="Add your first rule"
      intro="A rule turns a comment command into a run. We filled in the one most people start with."
      footer={{ back: backHref, next: { label: 'Save rules and finish', href: nextHref } }}
      aside={<GuardsCard maxRunsPerTicket={maxRunsPerTicket} changeHref={agentSettingsHref} ignoredHref={ignoredHref} />}
    >
      <RuleForm value={draft} skills={skills} agents={[draft.agent]} agentModel={agentModel} agentLocked onChange={setDraft} />
      <FollowUpRule command={followUp.command} target={followUp.target} skill={followUp.skill} enabled={follow} onChange={setFollow} />
    </SetupLayout>
  );
}
