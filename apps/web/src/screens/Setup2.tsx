import { useRef, useState } from 'react';
import { Banner, Field, Icon, RadioCard, StatusIcon, TextInput } from '@/ds';
import {
  ModelPicker,
  ProviderPicker,
  SecretField,
  SetupLayout,
  type CredentialType,
  type ModelList,
  type ProviderPickerOption,
} from '@/components';
import type { AgentKindView } from '@/mocks/types';
import { setupSteps, type SetupNav } from './setupSteps';
import styles from './Screens.module.css';

/** What Continue saves. `credential` is the typed secret: send it, never keep or log it. */
export interface Setup2Draft {
  /** The picked provider's kind. */
  provider: string;
  /** null = no credential choice made (a provider whose credential is optional). */
  credentialType: CredentialType | null;
  credential: string;
  /** The picked or typed default model; '' only for a provider whose model is optional. */
  model: string;
  /** The typed API address, trimmed; '' = the provider's default. */
  baseUrl: string;
  maxConcurrent: string;
}

const MODEL_REQUIRED = 'Enter a model name.';
const ENDPOINT_MODEL_REQUIRED = 'Enter the model your endpoint serves.';
const ENDPOINT_MODEL_HELP = 'The model id your endpoint serves, for example qwen3-coder.';
const LISTED_MODEL_HELP = "Loaded from the provider. Rules that don't name a model use this one.";
const NO_LOGIN_LINE =
  'OpenCode works without signing in. Leave the credential empty to use it that way, or add one of these.';
const NONE_CHOSEN = 'Pick an agent to continue.';
const LEAVE_LINE = 'Not ready yet? You can leave setup and come back; the project keeps your progress.';

export interface Setup2Props extends SetupNav {
  projectName: string;
  repo: string;
  /** The runnable providers with their capability rows; the step names no provider itself. */
  kinds: AgentKindView[];
  /** The picker's cards and Coming soon chips. */
  providers: ProviderPickerOption[];
  /** A return visit: the saved agent's provider, shown selected and read-only. */
  savedProvider?: string;
  /** The saved credential type (with `savedProvider`); defaults to the provider's first. */
  credentialType?: CredentialType;
  /** A credential is already saved: Continue works with an empty field. */
  credentialSaved?: boolean;
  /** A return visit with a saved credential: shows it as set ("Set <when> by <who>") with Replace, not the empty entry. */
  credentialInfo?: { setAt: string; setBy: string };
  /** A return visit: the saved agent's name, shown read-only next to the provider. */
  savedName?: string;
  secretState: 'entering' | 'empty';
  /** The models for the Default model picker (any provider without its own list in `modelLists`). */
  modelList: ModelList;
  /** Model lists by provider kind. */
  modelLists?: Partial<Record<string, ModelList>>;
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
  /** "Saving agent...", "Saving credential..." or "Testing connection...". */
  progress?: string;
  errors?: { credential?: string; model?: string; maxConcurrent?: string; baseUrl?: string };
  /** A failed save that names no field. */
  formError?: string;
  /** The credential was saved but the test rejected it or could not reach the address. */
  testFailed?: { status: string; message: string };
  /** Advances past a failed test ("Continue anyway"). */
  onContinueAnyway?(): void;
}

export function Setup2({
  projectName,
  exitHref,
  repo,
  kinds,
  providers,
  savedProvider,
  credentialType,
  credentialSaved = false,
  credentialInfo,
  savedName,
  secretState,
  modelList,
  modelLists,
  baseUrl = '',
  maxConcurrent,
  accepted,
  onSubmitCredential,
  backHref = '#',
  nextHref = '#',
  model: initialModel,
  onContinue,
  saving,
  progress,
  errors,
  formError,
  testFailed,
  onContinueAnyway,
}: Setup2Props) {
  const readOnlyProvider = savedProvider !== undefined;
  const [provider, setProvider] = useState<string | null>(savedProvider ?? null);
  const cap = kinds.find((k) => k.kind === provider);
  const firstType = (k: AgentKindView | undefined) =>
    k && !k.credentialOptional ? (k.credentialTypes[0]?.type ?? null) : null;
  const savedType = credentialType ?? firstType(kinds.find((k) => k.kind === savedProvider));
  const [type, setType] = useState<CredentialType | null>(savedType);
  // The person's pick; until they pick, the saved model (or the first listed one) shows, so a list that arrives
  // after mount is followed instead of a stale copy.
  const [picked, setPicked] = useState<string | null>(null);
  const [address, setAddress] = useState(baseUrl);
  const [concurrent, setConcurrent] = useState(String(maxConcurrent));
  const [noneChosen, setNoneChosen] = useState(false);
  const [local, setLocal] = useState<{ credential?: string; baseUrl?: string; model?: string }>({});
  // The secret stays in a ref (never rendered) and goes out only with Continue.
  const secret = useRef('');
  const [entryKey, setEntryKey] = useState(0);
  // A saved credential shows as set; Replace opens the entry and Cancel drops what was typed.
  const [replacing, setReplacing] = useState(false);
  const dropSecret = () => {
    secret.current = '';
    setEntryKey((k) => k + 1);
  };

  const list = (provider !== null && modelLists?.[provider]) || modelList;
  const typeInfo = cap?.credentialTypes.find((t) => t.type === type);
  // The saved credential of the provider and type on show (a switch to another type falls back to the entry).
  const showSaved = credentialSaved && credentialInfo !== undefined && provider === savedProvider && type === savedType;
  const addressSpec = cap?.baseUrl ?? null;
  const addressRequired = addressSpec !== null && type !== null && addressSpec.requiredFor.includes(type);
  const addressShown = addressSpec !== null && (addressSpec.requiredFor.length === 0 || addressRequired);
  const addressLabel = addressSpec && addressSpec.requiredFor.length > 0 ? 'API endpoint' : 'API address';
  const modelRequired = cap !== undefined && (!cap.modelOptional || addressRequired);
  const savedModel = readOnlyProvider ? initialModel : undefined;
  const shownModel: string | null = !cap
    ? null
    : addressRequired
      ? (picked ?? '')
      : cap.modelOptional
        ? (picked ?? savedModel ?? null)
        : (picked ?? savedModel ?? list.models[0]?.id ?? '');

  const pickProvider = (kind: string) => {
    if (readOnlyProvider || kind === provider) return;
    setProvider(kind);
    setType(firstType(kinds.find((k) => k.kind === kind)));
    setAddress('');
    setPicked(null);
    setNoneChosen(false);
    setLocal({});
    setReplacing(false);
    dropSecret();
  };
  const pickType = (next: CredentialType) => {
    if (next === type) return;
    setType(next);
    setPicked(null);
    setLocal({});
    // An address tied to the choice (an endpoint) goes with it.
    if (addressSpec && addressSpec.requiredFor.length > 0) setAddress('');
    dropSecret();
  };

  const submit = () => {
    if (!cap) {
      setNoneChosen(true);
      return;
    }
    const name = (shownModel ?? '').trim();
    const typedAddress = addressShown ? address.trim() : '';
    const typed = secret.current;
    const found: { credential?: string; baseUrl?: string; model?: string } = {};
    if (modelRequired && name === '') found.model = addressRequired ? ENDPOINT_MODEL_REQUIRED : MODEL_REQUIRED;
    if (addressRequired) {
      // Both halves of an endpoint and key go together; one alone is a message and nothing is sent.
      if (typedAddress !== '' && typed === '') found.credential = 'Enter the API key for this endpoint.';
      if (typedAddress === '' && typed !== '') found.baseUrl = 'Enter the API endpoint for this key.';
    } else if (!cap.credentialOptional && typed === '' && !credentialSaved) {
      found.credential = 'Paste the token to continue.';
    }
    setLocal(found);
    // The message sits on the entry, which a saved row hides: open it.
    if (found.credential && showSaved) setReplacing(true);
    if (Object.keys(found).length > 0) return;
    onContinue?.({
      provider: cap.kind,
      credentialType: type,
      credential: typed,
      model: name,
      baseUrl: typedAddress,
      maxConcurrent: concurrent,
    });
  };

  const next = onContinue
    ? { label: 'Continue', onClick: submit, pending: saving }
    : { label: 'Continue', href: nextHref };
  return (
    <SetupLayout
      projectName={projectName}
      exitHref={exitHref}
      steps={setupSteps({ repo, withWorkspace: true })}
      current={1}
      stepLabel="Step 2 of 5"
      title="Add your agent"
      intro="Pick the agent you work with. Runs use it unless a rule picks another agent. You can add more agents later."
      footer={{
        back: backHref,
        also: testFailed && onContinueAnyway ? { label: 'Continue anyway', onClick: onContinueAnyway } : undefined,
        note: LEAVE_LINE,
        next,
      }}
    >
      {formError && <Banner tone="err" icon={<Icon name="warning" size={16} />} title={formError} live="assertive" />}
      <ProviderPicker
        legend="Agent"
        options={providers}
        value={provider}
        onChange={pickProvider}
        readOnly={readOnlyProvider}
        error={noneChosen ? NONE_CHOSEN : undefined}
      />
      {savedName !== undefined && (
        <p className={styles.faintLine}>
          Agent name: <b className={styles.semi}>{savedName}</b>
        </p>
      )}
      {cap && (
        <>
          {cap.credentialTypes.length > 1 && (
            <Field label="Credential type" labelAs="span">
              {({ labelId }) => (
                <>
                  <div
                    className={`${styles.grid2Gap10} ${styles.stackPhone}`}
                    role="radiogroup"
                    aria-labelledby={labelId}
                  >
                    {cap.credentialTypes.map((t) => (
                      <RadioCard
                        key={t.type}
                        type="radio"
                        name="credential"
                        checked={type === t.type}
                        onChange={() => pickType(t.type)}
                        title={t.label}
                      />
                    ))}
                  </div>
                  {cap.credentialOptional && <span className={styles.faintLine}>{NO_LOGIN_LINE}</span>}
                </>
              )}
            </Field>
          )}
          {addressShown && addressSpec && (
            <Field label={addressLabel} help={addressSpec.help} error={errors?.baseUrl ?? local.baseUrl}>
              {({ id, describedBy, invalid }) => (
                <TextInput
                  mono
                  id={id}
                  aria-describedby={describedBy}
                  aria-invalid={invalid}
                  placeholder="https://"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                />
              )}
            </Field>
          )}
          {type !== null && (
            <SecretField
              key={`${provider ?? ''}-${type}-${entryKey}`}
              state={showSaved ? (replacing ? 'replacing' : 'saved') : secretState}
              savedInfo={credentialInfo}
              onReplace={() => setReplacing(true)}
              onCancel={() => {
                setReplacing(false);
                dropSecret();
              }}
              credentialTypes={cap.credentialTypes}
              credentialType={type}
              valueLabel={typeInfo?.valueLabel}
              hideSubmit={!onSubmitCredential}
              onSubmit={(value) => (onContinue ? submit() : onSubmitCredential?.(type, value))}
              onValueChange={
                onContinue &&
                ((value) => {
                  secret.current = value;
                })
              }
              error={errors?.credential ?? local.credential}
              revealLabel={`Show ${(typeInfo?.valueLabel ?? 'token').toLowerCase()} while typing`}
              entryHelp={typeInfo?.help}
            />
          )}
          {testFailed && (
            <Banner tone="err" icon={<Icon name="warning" size={16} />} title={testFailed.status} live="assertive">
              {testFailed.message}
            </Banner>
          )}
          <div className={`${styles.grid2Gap16} ${styles.stackPhone}`}>
            <ModelPicker
              label="Default model"
              list={list}
              value={shownModel}
              onChange={(nextModel) => {
                setPicked(nextModel ?? (cap.modelOptional ? null : ''));
                setLocal((l) => ({ ...l, model: undefined }));
              }}
              withDefault={cap.modelOptional && !addressRequired}
              defaultLabel={`${cap.label} default`}
              help={addressRequired ? ENDPOINT_MODEL_HELP : cap.modelOptional ? cap.modelHelp : LISTED_MODEL_HELP}
              typedHelp={addressRequired ? ENDPOINT_MODEL_HELP : cap.modelHelp}
              error={errors?.model ?? local.model}
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
        </>
      )}
      {progress && (
        <p className={styles.faintLine} role="status">
          {progress}
        </p>
      )}
      {accepted && cap && (
        <Banner tone="ok" icon={<StatusIcon status="succeeded" size={16} />}>
          <b className={styles.semi}>Token accepted.</b> A test call succeeded at {accepted.at}. Saved as secret{' '}
          <span className="mono">{accepted.secretName}</span>.
        </Banner>
      )}
    </SetupLayout>
  );
}
