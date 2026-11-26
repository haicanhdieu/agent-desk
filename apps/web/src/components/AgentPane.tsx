import { useState, type FormEvent } from 'react';
import type { CredentialType } from '@agentdesk/contracts';
import { Banner, Button, Checkbox, Field, Icon, SegmentedControl, TextInput } from '@/ds';
import type { AgentKindView, AgentPaneAgent } from '@/mocks/types';
import { AgentStatusMark } from './AgentStatus';
import { ModelPicker, type ModelList } from './ModelPicker';
import { ProviderMark } from './ProviderMark';
import { ProviderPicker, type ProviderPickerOption } from './ProviderPicker';
import { SecretField, type SecretFieldState } from './SecretField';
import { SidePane } from './SidePane';
import styles from './AgentPane.module.css';

export type AgentPaneMode = 'add' | 'edit' | 'view';

/** A secret typed in the pane, handed over once. The pane keeps no copy after the call. */
export interface AgentPaneCredential {
  type: CredentialType;
  value: string;
  /** Absent keeps the saved address, a string sets it, null clears it (the credential route's rule). */
  baseUrl?: string | null;
}

export interface AgentPaneValues {
  provider: string;
  name: string;
  /** '' = none. */
  accountLabel: string;
  /** '' = the provider's own default (only for a provider whose model is optional). */
  model: string;
  maxTurns: number | null;
  makeDefault: boolean;
  /** Add pane only: the typed credential, saved after the agent is created. Always null on Edit. */
  credential: AgentPaneCredential | null;
}

export type AgentPaneField = 'provider' | 'name' | 'accountLabel' | 'baseUrl' | 'model' | 'maxTurns' | 'value';

export interface AgentPaneProps {
  mode: AgentPaneMode;
  /** The runnable providers with their capability rows. The pane names no provider itself. */
  kinds: AgentKindView[];
  /** The picker's cards and Coming soon chips. */
  providers: ProviderPickerOption[];
  /** The saved agent (Edit and View). */
  agent?: AgentPaneAgent;
  modelList: ModelList;
  onClose(): void;
  onSubmit?(values: AgentPaneValues): void;
  /** Replaces the saved credential (and the address with it). Resolving `true` closes the replace panel. */
  onReplaceCredential?(credential: AgentPaneCredential, options: { makeDefault: boolean }): void | Promise<boolean>;
  onTest?(): void;
  /** A write is in flight: Save agent is disabled and reads `progress`. */
  saving?: boolean;
  /** "Saving agent…", "Saving credential…" or "Testing connection…". */
  progress?: string;
  /** A connection test runs. */
  testing?: boolean;
  /** Messages from the API (problem pointers) and the credential route, shown under their fields. */
  fieldErrors?: Partial<Record<AgentPaneField, string>>;
  /** Why the last credential save or test failed. */
  credentialError?: string;
  /** The agent was created but its credential was not saved. */
  partial?: { reason: string; requestId?: string };
  /** With `partial`: the non-secret values typed in the Add pane, which seed this pane (never the secret). */
  draft?: { makeDefault: boolean; authType: CredentialType | null; address: string };
  /** Another admin deleted the agent while the pane was open. */
  gone?: boolean;
  /** The reader may replace the credential (`secret:update`). Defaults to true outside View. */
  canReplaceCredential?: boolean;
}

const TITLES: Record<AgentPaneMode, string> = { add: 'Add agent', edit: 'Edit agent', view: 'View agent' };
const NO_LOGIN_LINE =
  'OpenCode works without signing in. Leave the credential empty to use it that way, or add one of these.';
const ENDPOINT_MODEL_HELP = 'The model id your endpoint serves, for example qwen3-coder.';
const ADD_MODEL_NOTE = 'Leave the box untouched to use the first standard model.';
const LISTED_MODEL_HELP = 'Loaded from the provider. Rules that don’t name a model use this one.';
const REPLACE_HELP =
  'We save it, then test it with one small call. If the test fails it stays saved and the agent shows the result.';
const CHANGED_ADDRESS_NOTE =
  'The API address changed. A saved credential is only sent to the address it was saved with, so paste it again for the new one.';
const CHANGED_ADDRESS_HELP =
  'We test the new token with one small call before saving. The address and the token are saved together; runs already in progress keep the ones they started with.';
const CHANGED_AUTH_NOTE = 'The authentication changed. Paste the new credential.';
const OWN_ADDRESS = 'the provider’s default address';

/** The fixed text under a status word in the Connection block. */
const CONNECTION_MESSAGES: Record<string, string> = {
  Ready: 'Connected',
  'Credential rejected': 'The provider refused the saved credential. Replace it, then test again.',
};

export function AgentPane({
  mode,
  kinds,
  providers,
  agent,
  modelList,
  onClose,
  onSubmit,
  onReplaceCredential,
  onTest,
  saving = false,
  progress,
  testing = false,
  fieldErrors = {},
  credentialError,
  partial,
  draft,
  gone = false,
  canReplaceCredential,
}: AgentPaneProps) {
  const readOnly = mode === 'view';
  const canReplace = canReplaceCredential ?? !readOnly;
  const [provider, setProvider] = useState<string | null>(agent?.provider ?? null);
  const cap = kinds.find((k) => k.kind === provider);
  const firstType = (k: AgentKindView | undefined) =>
    k && !k.credentialOptional ? k.credentialTypes[0]?.type : undefined;
  const [name, setName] = useState(agent?.name ?? '');
  const [accountLabel, setAccountLabel] = useState(agent?.accountLabel ?? '');
  const [authType, setAuthType] = useState<CredentialType | null>(
    agent?.credential.type ?? draft?.authType ?? firstType(cap) ?? null,
  );
  const [address, setAddress] = useState(agent?.baseUrl || draft?.address || '');
  const [model, setModel] = useState<string | null>(agent && agent.model !== '' ? agent.model : null);
  const [maxTurns, setMaxTurns] = useState(agent?.maxTurns != null ? String(agent.maxTurns) : '');
  const [makeDefault, setMakeDefault] = useState(agent?.isDefault === true || draft?.makeDefault === true);
  // The typed secret lives in SecretField; this copy only drives validation and is cleared on every hand-over.
  const [secret, setSecret] = useState('');
  const [entryKey, setEntryKey] = useState(0);
  const [replacing, setReplacing] = useState(false);
  const [attempted, setAttempted] = useState(false);
  // A saved value from outside (after a save or refetch) replaces an unsaved edit of the old one.
  const [seenAddress, setSeenAddress] = useState(agent?.baseUrl);
  const [seenType, setSeenType] = useState(agent?.credential.type);
  if (agent && (seenAddress !== agent.baseUrl || seenType !== agent.credential.type)) {
    setSeenAddress(agent.baseUrl);
    setSeenType(agent.credential.type);
    setAddress(agent.baseUrl);
    setAuthType(agent.credential.type ?? firstType(cap) ?? null);
  }

  const typeInfo = cap?.credentialTypes.find((t) => t.type === authType);
  const saved = mode !== 'add' && agent?.credential.set === true;
  const baseUrl = cap?.baseUrl ?? null;
  const addressRequired = baseUrl !== null && authType !== null && baseUrl.requiredFor.includes(authType);
  const addressShown = baseUrl !== null && (baseUrl.requiredFor.length === 0 || addressRequired);
  const addressLabel = baseUrl && baseUrl.requiredFor.length > 0 ? 'API endpoint' : 'API address';
  const typedAddress = addressShown ? address.trim() : '';
  const addressChanged = saved && typedAddress !== (agent?.baseUrl ?? '');
  const authChanged = saved && authType !== agent?.credential.type;
  const needsAgain = addressChanged || authChanged;
  const secretState: SecretFieldState = !saved ? 'entering' : replacing || needsAgain ? 'replacing' : 'saved';

  // Add: choosing no model is fine for a kind with built-in models (the API saves its first one); an address-requiring
  // choice needs one, and a model started and then emptied ("Other model…" with nothing typed) is an error.
  const modelRequired =
    cap !== undefined && (addressRequired || (!cap.modelOptional && (mode !== 'add' || model !== null)));
  // Add has no saved credential to list from, so it offers the kind's standard names (BR-19). Choosing none sends none.
  const pickerList: ModelList =
    mode === 'add' && cap !== undefined
      ? { models: cap.builtinModels, state: { kind: 'fallback', reason: 'no_credential', host: null } }
      : modelList;
  const autoModel = mode !== 'add' && cap !== undefined && !cap.modelOptional ? (modelList.models[0]?.id ?? '') : '';
  const shownModel = addressRequired ? (model ?? '') : cap?.modelOptional ? model : (model ?? autoModel);
  const effectiveModel = (shownModel ?? '').trim();

  // Both halves of an endpoint and key go together; each one alone is a message, and nothing is sent.
  // A saved credential with an unchanged address is not "missing": the key is only asked for again when it is replaced.
  const keyMissing = addressRequired && typedAddress !== '' && secret === '' && secretState !== 'saved';
  const endpointMissing = addressRequired && secret !== '' && typedAddress === '';
  const addressOnly = !addressRequired && !saved && typedAddress !== '' && secret === '';
  const liveSecretError = keyMissing
    ? 'Enter the API key for this endpoint.'
    : addressOnly
      ? 'Enter the credential for this address.'
      : undefined;
  const liveAddressError = endpointMissing ? 'Enter the API endpoint for this key.' : undefined;

  const turns = maxTurns.trim();
  const turnsInvalid = turns !== '' && !/^[1-9]\d*$/.test(turns);
  const localErrors = {
    name: name.trim() === '' ? 'Enter a name.' : undefined,
    model:
      modelRequired && effectiveModel === ''
        ? addressRequired
          ? 'Enter the model your endpoint serves.'
          : 'Enter a model name.'
        : undefined,
    maxTurns: turnsInvalid ? 'Enter a whole number of 1 or more.' : undefined,
  };
  const shown = (field: 'name' | 'model' | 'maxTurns') =>
    fieldErrors[field] ?? (attempted ? localErrors[field] : undefined);

  const pickProvider = (kind: string) => {
    if (kind === provider) return;
    const next = kinds.find((k) => k.kind === kind);
    setProvider(kind);
    setAuthType(firstType(next) ?? null);
    setAddress('');
    setModel(null);
    setSecret('');
    setEntryKey((k) => k + 1);
    setAttempted(false);
  };
  const pickAuth = (next: CredentialType | '') => {
    if (next === '' || next === authType) return;
    setAuthType(next);
    setSecret('');
    setEntryKey((k) => k + 1);
    setModel(null);
    // An address tied to the choice (an endpoint) goes with it; the saved one returns with the saved choice.
    if (baseUrl && baseUrl.requiredFor.length > 0)
      setAddress(next === agent?.credential.type ? (agent?.baseUrl ?? '') : '');
  };
  const handOver = () => {
    setSecret('');
    setEntryKey((k) => k + 1);
  };

  /** The credential route's body: the address only when it differs from the saved one. */
  const credentialBody = (value: string): AgentPaneCredential | null => {
    if (authType === null) return null;
    const body: AgentPaneCredential = { type: authType, value };
    if (mode === 'add') {
      if (typedAddress !== '') body.baseUrl = typedAddress;
    } else if (typedAddress !== (agent?.baseUrl ?? '')) {
      body.baseUrl = typedAddress === '' ? null : typedAddress;
    }
    return body;
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setAttempted(true);
    if (!cap || saving || readOnly) return;
    if (localErrors.name || localErrors.model || localErrors.maxTurns || liveSecretError || liveAddressError) return;
    if (mode === 'edit' && needsAgain) return;
    const credential = mode === 'add' && secret !== '' ? credentialBody(secret) : null;
    onSubmit?.({
      provider: cap.kind,
      name: name.trim(),
      accountLabel: accountLabel.trim(),
      model: effectiveModel,
      maxTurns: cap.supportsMaxTurns && mode === 'edit' && turns !== '' ? Number(turns) : null,
      makeDefault,
      credential,
    });
    if (credential) handOver();
  };

  const replaceCredential = async (value: string) => {
    const body = credentialBody(value);
    if (!body || (addressRequired && typedAddress === '')) return;
    handOver();
    const done = await onReplaceCredential?.(body, { makeDefault });
    if (done) setReplacing(false);
  };

  const replacingTexts = authChanged
    ? {
        title: 'Credential needed again',
        status: 'Replaced when you save',
        note: CHANGED_AUTH_NOTE,
        help: addressShown ? CHANGED_ADDRESS_HELP : REPLACE_HELP,
      }
    : addressChanged
      ? {
          title: 'Credential needed again',
          status: 'Replaced when you save',
          note: CHANGED_ADDRESS_NOTE,
          help: CHANGED_ADDRESS_HELP,
        }
      : undefined;

  const title = TITLES[mode];
  if (gone) {
    return (
      <SidePane title={title} onClose={onClose} footer={<Button onClick={onClose}>Close</Button>}>
        <Banner tone="warn" icon={<Icon name="warning" size={16} />} title="This agent no longer exists.">
          Another admin deleted it. Close this pane and reload the list.
        </Banner>
      </SidePane>
    );
  }

  const blocked = saving || (mode === 'edit' && needsAgain) || cap === undefined;
  const footer = readOnly ? (
    <div className={styles.footer}>
      <Button onClick={onClose}>Close</Button>
    </div>
  ) : (
    <div className={styles.footer}>
      <span className={styles.footNote}>Saving does not change runs that already started.</span>
      <Button variant="ghost" onClick={onClose}>
        Cancel
      </Button>
      <Button variant="primary" type="submit" form="agent-pane-form" disabled={blocked} aria-busy={saving || undefined}>
        {saving && progress ? progress : 'Save agent'}
      </Button>
    </div>
  );

  const connectionMessage = agent ? CONNECTION_MESSAGES[agent.status.text] : undefined;
  return (
    <SidePane title={title} onClose={onClose} footer={footer}>
      <form id="agent-pane-form" className={styles.form} onSubmit={submit} noValidate>
        {readOnly && <p className={styles.note}>You can see this agent but not change it.</p>}
        {partial && (
          <Banner
            tone="warn"
            icon={<Icon name="warning" size={16} />}
            title={`Agent saved, credential not saved: ${partial.reason}`}
            live="assertive"
          >
            Your typed values are kept. Save the credential again; the agent is not created twice.
            {partial.requestId && <span className={styles.request}>Request ID: {partial.requestId}</span>}
          </Banner>
        )}
        <fieldset className={styles.body} disabled={readOnly}>
          {mode === 'add' ? (
            <ProviderPicker
              options={providers}
              value={provider}
              onChange={pickProvider}
              error={fieldErrors.provider}
              autoFocus
            />
          ) : (
            <Field label="Provider" labelAs="span" help="Fixed after creation">
              {() => (
                <span className={styles.providerStatic}>
                  <ProviderMark kind={cap?.logo ?? ''} label={cap?.label ?? ''} size="sm" />
                  {cap?.label}
                </span>
              )}
            </Field>
          )}
          {!cap && <p className={styles.hint}>Pick a provider to set up its name, login and model.</p>}
          {cap && (
            <>
              <Field
                label="Name"
                help="How this agent shows in rules and runs, for example Claude - Personal."
                error={shown('name')}
              >
                {({ id, describedBy, invalid }) => (
                  <TextInput
                    id={id}
                    aria-describedby={describedBy}
                    aria-invalid={invalid}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    autoComplete="off"
                  />
                )}
              </Field>
              <Field
                label="Account label"
                help="Optional. Who or what this account is, for example Personal or Work."
                error={fieldErrors.accountLabel}
              >
                {({ id, describedBy, invalid }) => (
                  <TextInput
                    id={id}
                    aria-describedby={describedBy}
                    aria-invalid={invalid}
                    value={accountLabel}
                    onChange={(e) => setAccountLabel(e.target.value)}
                    autoComplete="off"
                  />
                )}
              </Field>
              {secretState === 'entering' && cap.credentialTypes.length > 1 && (
                <div className={styles.auth}>
                  <span className={styles.authLabel} id="agent-pane-auth">
                    Authentication
                  </span>
                  <SegmentedControl<CredentialType | ''>
                    aria-labelledby="agent-pane-auth"
                    value={authType ?? ''}
                    options={cap.credentialTypes.map((t) => ({ value: t.type, label: t.label }))}
                    onChange={pickAuth}
                  />
                  {cap.credentialOptional && <span className={styles.help}>{NO_LOGIN_LINE}</span>}
                </div>
              )}
              {addressShown && baseUrl && (
                <Field
                  label={addressLabel}
                  help={
                    addressChanged && !authChanged
                      ? `Changed from ${agent?.baseUrl || OWN_ADDRESS}. It is saved together with the new credential below.`
                      : baseUrl.help
                  }
                  error={fieldErrors.baseUrl ?? liveAddressError}
                >
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
              {(authType !== null || secretState !== 'entering') && (
                <Field label="Credential" labelAs="span">
                  {({ labelId }) => (
                    <div role="group" aria-labelledby={labelId}>
                      <SecretField
                        key={`${authType ?? ''}-${entryKey}`}
                        state={secretState}
                        credentialType={authType ?? cap.credentialTypes[0].type}
                        credentialTypes={cap.credentialTypes}
                        typeLabel="Authentication"
                        valueLabel={typeInfo?.valueLabel}
                        entryHelp={typeInfo?.help}
                        replaceHelp={REPLACE_HELP}
                        replacing={replacingTexts}
                        savedInfo={
                          agent?.credential.set
                            ? {
                                setAt: agent.credential.setAt,
                                setBy: agent.credential.setBy,
                              }
                            : undefined
                        }
                        nested
                        hideSubmit={mode === 'add'}
                        hideReplace={!canReplace}
                        submitLabel="Save and test"
                        submitDisabled={addressRequired && typedAddress === ''}
                        error={credentialError ?? fieldErrors.value ?? liveSecretError}
                        onValueChange={setSecret}
                        onCredentialTypeChange={pickAuth}
                        onReplace={() => setReplacing(true)}
                        onCancel={() => {
                          setReplacing(false);
                          setAddress(agent?.baseUrl ?? '');
                          setAuthType(agent?.credential.type ?? null);
                        }}
                        onSubmit={(value) => void replaceCredential(value)}
                      />
                    </div>
                  )}
                </Field>
              )}
              <ModelPicker
                label="Default model"
                list={pickerList}
                value={shownModel}
                onChange={setModel}
                withDefault={cap.modelOptional && !addressRequired}
                defaultLabel={`${cap.label} default`}
                help={addressRequired ? ENDPOINT_MODEL_HELP : cap.modelOptional ? cap.modelHelp : LISTED_MODEL_HELP}
                typedHelp={
                  addressRequired
                    ? ENDPOINT_MODEL_HELP
                    : mode === 'add' && !cap.modelOptional
                      ? `${cap.modelHelp} ${ADD_MODEL_NOTE}`
                      : cap.modelHelp
                }
                error={shown('model') ?? fieldErrors.model}
              />
              {mode !== 'add' && cap.supportsMaxTurns && (
                <Field
                  label="Max turns"
                  help="Optional. The most turns one run may take on this agent. Leave empty for no limit."
                  error={shown('maxTurns')}
                >
                  {({ id, describedBy, invalid }) => (
                    <TextInput
                      numeric
                      id={id}
                      inputMode="numeric"
                      aria-describedby={describedBy}
                      aria-invalid={invalid}
                      value={maxTurns}
                      onChange={(e) => setMaxTurns(e.target.value)}
                    />
                  )}
                </Field>
              )}
              <div className={styles.check}>
                <Checkbox
                  aria-label="Use as the project default"
                  checked={makeDefault}
                  disabled={agent?.isDefault === true}
                  onChange={setMakeDefault}
                />
                <span className={styles.checkText}>
                  <span>Use as the project default</span>
                  {agent?.isDefault && (
                    <span className={styles.help}>Set another agent as default to change this.</span>
                  )}
                </span>
              </div>
            </>
          )}
        </fieldset>
        {progress && (
          <p className={styles.progress} role="status">
            {progress}
          </p>
        )}
      </form>
      {mode !== 'add' && agent && (
        <section className={styles.connection} aria-label="Connection">
          <h3 className={styles.connectionTitle}>Connection</h3>
          <div className={styles.connectionRow}>
            <AgentStatusMark tone={agent.status.tone} text={agent.status.text} />
            <span className={styles.help}>{agent.testedAt ? `Last test ${agent.testedAt}.` : 'Not tested yet.'}</span>
            <Button size="sm" icon="refresh" disabled={readOnly || testing} onClick={onTest}>
              {testing ? 'Testing…' : 'Test connection'}
            </Button>
          </div>
          {connectionMessage && <span className={styles.help}>{connectionMessage}</span>}
        </section>
      )}
    </SidePane>
  );
}
