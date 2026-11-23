import { useRef, useState } from 'react';
import { Banner, Field, Icon, RadioCard, StatusIcon, TextInput, CommandChip } from '@/ds';
import { ModelPicker, SecretField, SetupLayout, type CredentialType, type ModelList } from '@/components';
import type { Actor } from '@/mocks/types';
import type { OrgSwitchProps } from '@/components';
import { setupSteps, type SetupNav } from './setupSteps';
import styles from './Screens.module.css';

/** What Continue saves. `credential` is the typed secret: send it, never keep or log it. */
export interface Setup2Draft {
  credentialType: CredentialType;
  credential: string;
  /** The picked or typed default model; never empty. */
  model: string;
  /** The typed API address, trimmed; '' = the provider's default. */
  baseUrl: string;
  maxConcurrent: string;
}

const MODEL_REQUIRED = 'Enter a model name.';
const addressHelp = (
  <>
    Optional. Leave empty for Anthropic's default. Runs get it as <span className="mono">ANTHROPIC_BASE_URL</span>.
    Public https addresses only.
  </>
);

export interface Setup2Props extends SetupNav {
  user: Actor;
  /** The org crumb and menu in the top bar. */
  org?: OrgSwitchProps;
  projectName: string;
  repo: string;
  credentialType: CredentialType;
  secretState: 'entering' | 'empty';
  /** The agent's models for the Default model picker. */
  modelList: ModelList;
  /** The saved API address ('' = default); the address field starts with it. */
  baseUrl?: string;
  maxConcurrent: number;
  accepted?: { at: string; secretName: string };
  /** Receives the typed token. It is never rendered after submit. */
  onSubmitCredential?(type: CredentialType, value: string): void;
  /** The saved default model. Defaults to the first listed model. */
  model?: string;
  /** Saves the step (Continue, or Enter in the token field). With it, Continue is a button. */
  onContinue?(draft: Setup2Draft): void;
  saving?: boolean;
  errors?: { credential?: string; model?: string; maxConcurrent?: string; baseUrl?: string };
  /** A failed save that names no field. */
  formError?: string;
}

export function Setup2({
  user,
  org,
  projectName,
  repo,
  credentialType,
  secretState,
  modelList,
  baseUrl = '',
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
  // The person's pick; until they pick, the saved model (or the first listed one) shows, so a list that arrives
  // after mount is followed instead of a stale copy.
  const [picked, setPicked] = useState<string | null>(null);
  const model = picked ?? initialModel ?? modelList.models[0]?.id ?? '';
  const [emptyModel, setEmptyModel] = useState(false);
  const [address, setAddress] = useState(baseUrl);
  const [concurrent, setConcurrent] = useState(String(maxConcurrent));
  // The secret stays in a ref (never rendered) and goes out only with Continue.
  const secret = useRef('');
  const submit = () => {
    const name = model.trim();
    if (name === '') {
      setEmptyModel(true);
      return;
    }
    onContinue?.({
      credentialType: type,
      credential: secret.current,
      model: name,
      baseUrl: address.trim(),
      maxConcurrent: concurrent,
    });
  };
  return (
    <SetupLayout
      user={user}
      org={org}
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
      <Field label="API address" help={addressHelp} error={errors?.baseUrl}>
        {({ id, describedBy, invalid }) => (
          <TextInput
            mono
            id={id}
            aria-describedby={describedBy}
            aria-invalid={invalid}
            placeholder="https://api.anthropic.com"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
        )}
      </Field>
      <div className={styles.grid2Gap16}>
        <ModelPicker
          label="Default model"
          list={modelList}
          value={model}
          onChange={(next) => {
            setPicked(next ?? '');
            setEmptyModel(false);
          }}
          help="Loaded from the provider. Rules that don't name a model use this one."
          typedHelp="Sent to Claude Code exactly as typed. Rules that don't name a model use this one."
          error={errors?.model ?? (emptyModel ? MODEL_REQUIRED : undefined)}
        />
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
