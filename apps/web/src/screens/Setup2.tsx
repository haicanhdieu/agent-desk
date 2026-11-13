import { useRef, useState } from 'react';
import { Banner, Field, Icon, RadioCard, Select, StatusIcon, TextInput, CommandChip } from '@/ds';
import { SecretField, SetupLayout, type CredentialType } from '@/components';
import type { Actor } from '@/mocks/types';
import { setupSteps, type SetupNav } from './setupSteps';
import styles from './Screens.module.css';

/** What Continue saves. `credential` is the typed secret: send it, never keep or log it. */
export interface Setup2Draft {
  credentialType: CredentialType;
  credential: string;
  model: string;
  maxConcurrent: string;
}

export interface Setup2Props extends SetupNav {
  user: Actor;
  projectName: string;
  repo: string;
  credentialType: CredentialType;
  secretState: 'entering' | 'empty';
  models: string[];
  maxConcurrent: number;
  accepted?: { at: string; secretName: string };
  /** Receives the typed token. It is never rendered after submit. */
  onSubmitCredential?(type: CredentialType, value: string): void;
  /** Initially selected model. Defaults to the first. */
  model?: string;
  /** Saves the step (Continue, or Enter in the token field). With it, Continue is a button. */
  onContinue?(draft: Setup2Draft): void;
  saving?: boolean;
  errors?: { credential?: string; model?: string; maxConcurrent?: string };
  /** A failed save that names no field. */
  formError?: string;
}

export function Setup2({
  user,
  projectName,
  repo,
  credentialType,
  secretState,
  models,
  maxConcurrent,
  accepted,
  onSubmitCredential,
  backHref = '#',
  nextHref = '#',
  model: initialModel,
  onContinue,
  saving,
  errors,
  formError,
}: Setup2Props) {
  const [type, setType] = useState<CredentialType>(credentialType);
  const [model, setModel] = useState(initialModel ?? models[0] ?? '');
  const [concurrent, setConcurrent] = useState(String(maxConcurrent));
  // The secret stays in a ref (never rendered) and goes out only with Continue.
  const secret = useRef('');
  const submit = () =>
    onContinue?.({ credentialType: type, credential: secret.current, model, maxConcurrent: concurrent });
  return (
    <SetupLayout
      user={user}
      projectName={projectName}
      steps={setupSteps({ repo, withWorkspace: true })}
      current={1}
      stepLabel="Step 2 of 5"
      title="Add the Claude credential"
      intro="Every run in this project uses it. It is stored as a secret and is never shown again, not even to you."
      footer={{
        back: backHref,
        next: onContinue
          ? { label: 'Continue', onClick: submit, pending: saving }
          : { label: 'Continue', href: nextHref },
      }}
    >
      {formError && <Banner tone="err" icon={<Icon name="warning" size={16} />} title={formError} live="assertive" />}
      <Field label="Credential type" labelAs="span">
        {({ labelId }) => (
          <div className={styles.grid2Gap10} role="radiogroup" aria-labelledby={labelId}>
            <RadioCard
              type="radio"
              name="credential"
              checked={type === 'oauth_token'}
              onChange={() => setType('oauth_token')}
              title="Claude Code OAuth token"
              description={
                <>
                  From <CommandChip>claude setup-token</CommandChip>. Uses your subscription.
                </>
              }
              faintDescription
            />
            <RadioCard
              type="radio"
              name="credential"
              checked={type === 'api_key'}
              onChange={() => setType('api_key')}
              title="API key"
              description="Billed per token. Usage cost shows on each run."
              faintDescription
            />
          </div>
        )}
      </Field>
      <SecretField
        state={secretState}
        credentialType={type}
        hideSubmit={!onSubmitCredential}
        onSubmit={(value) => (onContinue ? submit() : onSubmitCredential?.(type, value))}
        onValueChange={
          onContinue &&
          ((value) => {
            secret.current = value;
          })
        }
        error={errors?.credential}
        revealLabel="Show token while typing"
        entryHelp="Use a dedicated token with a low limit. The agent process can read it inside the run container."
      />
      <div className={styles.grid2Gap16}>
        <Field label="Model" error={errors?.model}>
          {({ id, describedBy, invalid }) => (
            <Select
              id={id}
              aria-describedby={describedBy}
              aria-invalid={invalid}
              value={model}
              onChange={(e) => setModel(e.target.value)}
            >
              {models.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </Select>
          )}
        </Field>
        <Field
          label="Concurrent runs"
          help="Idle runs hold a slot until you finish them."
          error={errors?.maxConcurrent}
        >
          {({ id, describedBy, invalid }) => (
            <TextInput
              numeric
              id={id}
              aria-describedby={describedBy}
              aria-invalid={invalid}
              value={concurrent}
              onChange={(e) => setConcurrent(e.target.value)}
            />
          )}
        </Field>
      </div>
      {accepted && (
        <Banner tone="ok" icon={<StatusIcon status="succeeded" size={16} />}>
          <b className={styles.semi}>Token accepted.</b> A test call succeeded at {accepted.at}. Saved as secret{' '}
          <span className="mono">{accepted.secretName}</span>.
        </Banner>
      )}
    </SetupLayout>
  );
}
