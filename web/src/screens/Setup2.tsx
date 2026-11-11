import { useState } from 'react';
import { Banner, Field, RadioCard, Select, StatusIcon, TextInput, CommandChip } from '@/ds';
import { SecretField, SetupLayout, type CredentialType } from '@/components';
import type { Actor } from '@/mocks/types';
import { setupSteps, type SetupNav } from './setupSteps';
import styles from './Screens.module.css';

export interface Setup2Props extends SetupNav {
  user: Actor;
  projectName: string;
  repo: string;
  credentialType: CredentialType;
  secretState: 'entering' | 'empty';
  models: string[];
  maxConcurrent: number;
  accepted?: { at: string; secretName: string };
}

export function Setup2({
  user, projectName, repo, credentialType, secretState, models, maxConcurrent, accepted, backHref = '#', nextHref = '#',
}: Setup2Props) {
  const [type, setType] = useState<CredentialType>(credentialType);
  return (
    <SetupLayout
      user={user}
      projectName={projectName}
      steps={setupSteps({ repo })}
      current={1}
      stepLabel="Step 2 of 4"
      title="Add the Claude credential"
      intro="Every run in this project uses it. It is stored as a secret and is never shown again, not even to you."
      footer={{ back: backHref, next: { label: 'Continue', href: nextHref } }}
    >
      <Field label="Credential type" labelAs="span">
        {({ labelId }) => (
          <div className={styles.grid2Gap10} role="radiogroup" aria-labelledby={labelId}>
            <RadioCard
              type="radio" name="credential" checked={type === 'oauth_token'} onChange={() => setType('oauth_token')}
              title="Claude Code OAuth token"
              description={<>From <CommandChip>claude setup-token</CommandChip>. Uses your subscription.</>}
              faintDescription
            />
            <RadioCard
              type="radio" name="credential" checked={type === 'api_key'} onChange={() => setType('api_key')}
              title="API key" description="Billed per token. Usage cost shows on each run." faintDescription
            />
          </div>
        )}
      </Field>
      <SecretField
        state={secretState}
        credentialType={type}
        hideSubmit
        revealLabel="Show token while typing"
        entryHelp="Use a dedicated token with a low limit. The agent process can read it inside the run container."
      />
      <div className={styles.grid2Gap16}>
        <Field label="Model">
          {({ id }) => <Select id={id} defaultValue={models[0]}>{models.map((m) => <option key={m}>{m}</option>)}</Select>}
        </Field>
        <Field label="Concurrent runs" help="Idle runs hold a slot until you finish them.">
          {({ id, describedBy }) => <TextInput numeric id={id} aria-describedby={describedBy} defaultValue={String(maxConcurrent)} />}
        </Field>
      </div>
      {accepted && (
        <Banner tone="ok" icon={<StatusIcon status="succeeded" size={16} />}>
          <b className={styles.semi}>Token accepted.</b> A test call succeeded at {accepted.at}. Saved as secret <span className="mono">{accepted.secretName}</span>.
        </Banner>
      )}
    </SetupLayout>
  );
}
