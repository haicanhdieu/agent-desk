import { useState, type ReactNode } from 'react';
import {
  Banner,
  Button,
  Dialog,
  DurationInput,
  Field,
  Icon,
  TextInput,
  UnitInput,
  minutesIn,
  splitMinutes,
} from '@/ds';
import {
  DangerZone,
  KeyValue,
  ModelPicker,
  SecretField,
  SettingsSection,
  TriggerModeSetting,
  type SecretFieldState,
} from '@/components';
import type { CredentialType, ModelList } from '@/components';
import { connectionCopy as c, DEFAULT_POLL_INTERVAL } from '@/mocks/connection';
import type { AgentSettings, ConnectionStatus, PollInterval, TriggerMode } from '@/mocks/types';
import styles from './Screens.module.css';
import { DeskFrame, type DeskFrameData } from './DeskFrame';
import { deleteProjectBody } from './deleteProjectCopy';

export type LimitField =
  | 'timeoutMinutes'
  | 'pausedKeepMinutes'
  | 'doneKeepMinutes'
  | 'idleEndMinutes'
  | 'maxConcurrent'
  | 'maxRunsPerTicket'
  | 'autoResumeMax';
export type AgentLimits = Record<LimitField, number>;

export interface DeskAgentProps {
  /** Top bar and Desk navigation data. */
  frame: DeskFrameData;
  settings: AgentSettings;
  /** GitHub connection rows. A Trigger mode row is added after Repository. */
  github: { term: string; value: ReactNode }[];
  replacingCredential?: boolean;
  /** Project connection; its mode is the initial trigger mode. Shown in the side nav. */
  connection?: ConnectionStatus;
  pollInterval?: PollInterval;
  /** The trigger mode shown, when the caller owns it (e.g. back to the saved mode after a failed change). */
  trigger?: { mode: TriggerMode; interval: PollInterval };
  onTriggerChange?(trigger: { mode: TriggerMode; interval: PollInterval }): void;
  /** Why the last trigger mode change failed. */
  triggerError?: string;
  /** Check now (polling mode): poll the connection right away. */
  onCheckNow?(): void;
  /** A check is running: Check now is disabled and says so. */
  checkingNow?: boolean;
  /** Why the last check failed or was refused (e.g. polling is paused), with what to do about it. */
  checkNowError?: string;
  onSaveLimits?(limits: AgentLimits): void;
  /** Per-field messages from a refused limits save; the typed values stay. */
  limitsErrors?: Partial<Record<LimitField, string>>;
  /** A limits save failure that belongs to no field. */
  limitsError?: string;
  /** A limits save is in flight: Save limits stays disabled. */
  savingLimits?: boolean;
  /** Called after the delete is confirmed in a dialog. Without it the Danger zone is not rendered (project admins). */
  onDeleteProject?(): void;
  /**
   * Receives the typed replacement token. It is never rendered after submit. Resolving `true` closes the replace
   * panel (saved); otherwise it stays open with `credentialError`.
   */
  onReplaceCredential?(type: CredentialType, value: string, baseUrl?: string | null): void | Promise<boolean>;
  credentialError?: string;
  /** The agent's models for the Default model picker. Absent while loading. */
  modelList?: ModelList;
  /** "Save agent": the picked or typed default model (never empty). Resolving `false` keeps the form as typed. */
  onSaveAgent?(model: string): void | Promise<boolean>;
  /** A save of the agent is in flight: Save agent stays disabled. */
  savingAgent?: boolean;
  /** Why the last agent save refused the model. */
  modelError?: string;
  /** Why the last credential save refused the API address. */
  addressError?: string;
  /** Stories: the address typed at mount (defaults to the saved one). */
  initialAddress?: string;
}

const LOADING_LIST: ModelList = { models: [], state: { kind: 'loading' } };
const MODEL_REQUIRED = 'Enter a model name.';
const addressHelp = (
  <>
    Optional. Leave empty for Anthropic's default. Runs get it as <span className="mono">ANTHROPIC_BASE_URL</span>.
    Public https addresses only. Changing it needs the credential again.
  </>
);

const narrow = { width: 90 };

export function DeskAgent({
  frame,
  settings,
  github,
  replacingCredential = false,
  connection,
  pollInterval = DEFAULT_POLL_INTERVAL,
  trigger,
  onTriggerChange,
  triggerError,
  onCheckNow,
  checkingNow = false,
  checkNowError,
  onSaveLimits,
  limitsErrors = {},
  limitsError,
  savingLimits = false,
  onDeleteProject,
  onReplaceCredential,
  credentialError,
  modelList = LOADING_LIST,
  onSaveAgent,
  savingAgent = false,
  modelError,
  addressError,
  initialAddress,
}: DeskAgentProps) {
  const [ownMode, setMode] = useState<TriggerMode>(connection?.mode ?? 'webhook');
  const [ownInterval, setPollEvery] = useState(pollInterval);
  const mode = trigger?.mode ?? ownMode;
  const interval = trigger?.interval ?? ownInterval;
  const pick = (next: { mode: TriggerMode; interval: PollInterval }) => {
    setMode(next.mode);
    setPollEvery(next.interval);
    onTriggerChange?.(next);
  };
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  // The trigger mode row sits right after Repository, as on the board.
  const triggerRow = {
    term: c.triggerModeTerm,
    value: <TriggerModeSetting mode={mode} interval={interval} onChange={pick} error={triggerError} />,
  };
  const at = github.findIndex((g) => g.term === 'Repository') + 1 || github.length;
  const items = [...github.slice(0, at), triggerRow, ...github.slice(at)];
  const [replacing, setReplacing] = useState(replacingCredential);
  const [credType, setCredType] = useState<CredentialType>(settings.credential.type);
  const [timeoutUnit, setTimeoutUnit] = useState(() => splitMinutes(settings.timeoutMinutes).unit);
  const [pausedKeepUnit, setPausedKeepUnit] = useState(() => splitMinutes(settings.pausedKeepMinutes).unit);
  const [doneKeepUnit, setDoneKeepUnit] = useState(() => splitMinutes(settings.doneKeepMinutes).unit);
  const [limits, setLimits] = useState({
    timeout: splitMinutes(settings.timeoutMinutes).value,
    pausedKeep: splitMinutes(settings.pausedKeepMinutes).value,
    doneKeep: splitMinutes(settings.doneKeepMinutes).value,
    idle: String(settings.idleEndMinutes),
    concurrent: String(settings.maxConcurrent),
    perTicket: String(settings.maxRunsPerTicket),
    autoResume: String(settings.autoResumeMax),
  });
  const set = (k: keyof typeof limits) => (e: { target: { value: string } }) =>
    setLimits({ ...limits, [k]: e.target.value });
  // What the person is editing; a new saved value (after a save or refetch) replaces an unsaved edit of the old one.
  const [model, setModel] = useState<string | null>(settings.model);
  const [seenModel, setSeenModel] = useState(settings.model);
  const [emptyModel, setEmptyModel] = useState(false);
  if (seenModel !== settings.model) {
    setSeenModel(settings.model);
    setModel(settings.model);
    setEmptyModel(false);
  }
  const [address, setAddress] = useState(initialAddress ?? settings.baseUrl);
  const [seenAddress, setSeenAddress] = useState(settings.baseUrl);
  if (seenAddress !== settings.baseUrl) {
    setSeenAddress(settings.baseUrl);
    setAddress(settings.baseUrl);
  }
  const typedAddress = address.trim();
  const addressChanged = typedAddress !== settings.baseUrl;
  const state: SecretFieldState = replacing || addressChanged ? 'replacing' : 'saved';
  const changedFrom = settings.baseUrl ? settings.baseUrl : "Anthropic's default";
  const replaceCredential = async (value: string) => {
    // Absent = the address is unchanged; '' typed = clear it (null); otherwise the typed address.
    const saved = addressChanged
      ? await onReplaceCredential?.(credType, value, typedAddress === '' ? null : typedAddress)
      : await onReplaceCredential?.(credType, value);
    if (saved) setReplacing(false);
  };
  const saveAgent = () => {
    const name = (model ?? '').trim();
    if (name === '') {
      setEmptyModel(true);
      return;
    }
    void onSaveAgent?.(name);
  };
  return (
    <DeskFrame active="agent" {...frame} connection={connection ?? frame.connection}>
      <main className={styles.agentMain}>
        <h1>Agent &amp; settings</h1>
        <SettingsSection title="GitHub connection" description="Where commands come from and where agents write.">
          <KeyValue termWidth={150} items={items} />
          <div className={styles.deskActions}>
            <Button size="sm" icon="external" href="https://github.com/">
              Manage installation on GitHub
            </Button>
            {mode === 'webhook' ? (
              <Button variant="ghost" size="sm" icon="refresh">
                Send test ping
              </Button>
            ) : (
              <Button variant="ghost" size="sm" icon="refresh" onClick={onCheckNow} disabled={checkingNow}>
                {checkingNow ? c.checking : c.checkNow}
              </Button>
            )}
          </div>
          {checkNowError && (
            <Banner tone="err" icon={<Icon name="warning" size={16} />} title={checkNowError} live="assertive" />
          )}
        </SettingsSection>
        <SettingsSection title="Agent" description="Every run in this project uses this agent and credential.">
          <div className={styles.grid2Gap16}>
            <Field label="Agent" help="Claude Code CLI. Other agents come later.">
              {({ id, describedBy }) => (
                <TextInput id={id} aria-describedby={describedBy} value={settings.agent} disabled readOnly />
              )}
            </Field>
            <ModelPicker
              label="Default model"
              list={modelList}
              value={model}
              onChange={(next) => {
                setModel(next);
                setEmptyModel(false);
              }}
              help="Loaded from the provider. Rules that don't name a model use this one."
              typedHelp="Sent to Claude Code exactly as typed. Rules that don't name a model use this one."
              error={modelError ?? (emptyModel ? MODEL_REQUIRED : undefined)}
            />
          </div>
          <div className={styles.actionsEnd}>
            <Button variant="primary" disabled={savingAgent} aria-busy={savingAgent || undefined} onClick={saveAgent}>
              Save agent
            </Button>
          </div>
          <Field
            label="API address"
            help={
              addressChanged
                ? `Changed from ${changedFrom}. It is saved together with the new credential below.`
                : addressHelp
            }
            error={addressError}
          >
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
          <Field label="Credential" labelAs="span">
            {({ labelId }) => (
              <div role="group" aria-labelledby={labelId}>
                <SecretField
                  state={state}
                  credentialType={credType}
                  onCredentialTypeChange={setCredType}
                  savedInfo={settings.credential.setAt ? settings.credential : undefined}
                  onReplace={() => setReplacing(true)}
                  onCancel={() => {
                    setReplacing(false);
                    setAddress(settings.baseUrl);
                  }}
                  replacing={
                    addressChanged
                      ? {
                          title: 'Credential needed again',
                          status: 'Replaced when you save',
                          note: 'The API address changed. A saved credential is only sent to the address it was saved with, so paste it again for the new one.',
                          help: 'We test the new token with one small call before saving. The address and the token are saved together; runs already in progress keep the ones they started with.',
                        }
                      : undefined
                  }
                  onSubmit={(value) => void replaceCredential(value)}
                  error={credentialError}
                />
              </div>
            )}
          </Field>
        </SettingsSection>
        <SettingsSection title="Limits" description="Guards against runaway cost and stuck runs.">
          <div className={`${styles.grid2Gap16} ${styles.limitsGrid}`}>
            <Field
              label="Run time limit"
              help="From 1 minute to 7 days. The repo token is renewed while the run lasts."
              error={limitsErrors.timeoutMinutes}
            >
              {({ id, describedBy, invalid }) => (
                <DurationInput
                  id={id}
                  aria-describedby={describedBy}
                  aria-invalid={invalid}
                  unitLabel="Run time limit unit"
                  unit={timeoutUnit}
                  onUnitChange={setTimeoutUnit}
                  value={limits.timeout}
                  onChange={set('timeout')}
                />
              )}
            </Field>
            <Field
              label="Keep a paused run for"
              help="After this, a paused run expires and its saved session is deleted."
              error={limitsErrors.pausedKeepMinutes}
            >
              {({ id, describedBy, invalid }) => (
                <DurationInput
                  id={id}
                  aria-describedby={describedBy}
                  aria-invalid={invalid}
                  unitLabel="Keep a paused run for unit"
                  unit={pausedKeepUnit}
                  onUnitChange={setPausedKeepUnit}
                  value={limits.pausedKeep}
                  onChange={set('pausedKeep')}
                />
              )}
            </Field>
            <Field
              label="Keep a finished run's session for"
              help="How long a finished run can be reopened. 0 turns this off."
              error={limitsErrors.doneKeepMinutes}
            >
              {({ id, describedBy, invalid }) => (
                <DurationInput
                  id={id}
                  aria-describedby={describedBy}
                  aria-invalid={invalid}
                  unitLabel="Keep a finished run's session for unit"
                  unit={doneKeepUnit}
                  onUnitChange={setDoneKeepUnit}
                  value={limits.doneKeep}
                  onChange={set('doneKeep')}
                />
              )}
            </Field>
            <Field
              label="End idle runs after"
              help="Only counts while no terminal is open."
              error={limitsErrors.idleEndMinutes}
            >
              {({ id, describedBy, invalid }) => (
                <UnitInput
                  id={id}
                  aria-describedby={describedBy}
                  aria-invalid={invalid}
                  unit="minutes unattended"
                  value={limits.idle}
                  onChange={set('idle')}
                />
              )}
            </Field>
            <Field
              label="Concurrent runs"
              help="Idle runs count. Extra runs wait in the queue."
              error={limitsErrors.maxConcurrent}
            >
              {({ id, describedBy, invalid }) => (
                <TextInput
                  numeric
                  id={id}
                  aria-describedby={describedBy}
                  aria-invalid={invalid}
                  inputMode="numeric"
                  style={narrow}
                  value={limits.concurrent}
                  onChange={set('concurrent')}
                />
              )}
            </Field>
            <Field
              label="Runs per ticket"
              help="Stops runaway chains. Further commands are ignored."
              error={limitsErrors.maxRunsPerTicket}
            >
              {({ id, describedBy, invalid }) => (
                <TextInput
                  numeric
                  id={id}
                  aria-describedby={describedBy}
                  aria-invalid={invalid}
                  inputMode="numeric"
                  style={narrow}
                  value={limits.perTicket}
                  onChange={set('perTicket')}
                />
              )}
            </Field>
            <Field
              label="Automatic resumes after a crash"
              help="How many times in a row a run resumes by itself after its pod is killed or the agent crashes. Typing in the terminal or pressing Resume starts the count again. 0 turns it off."
              error={limitsErrors.autoResumeMax}
            >
              {({ id, describedBy, invalid }) => (
                <TextInput
                  numeric
                  id={id}
                  aria-describedby={describedBy}
                  aria-invalid={invalid}
                  inputMode="numeric"
                  style={narrow}
                  value={limits.autoResume}
                  onChange={set('autoResume')}
                />
              )}
            </Field>
          </div>
          {limitsError && (
            <Banner tone="err" icon={<Icon name="warning" size={16} />} title={limitsError} live="assertive" />
          )}
          <div className={styles.actionsEnd}>
            <Button
              variant="primary"
              disabled={savingLimits}
              aria-busy={savingLimits || undefined}
              onClick={() =>
                onSaveLimits?.({
                  timeoutMinutes: minutesIn(limits.timeout, timeoutUnit),
                  pausedKeepMinutes: minutesIn(limits.pausedKeep, pausedKeepUnit),
                  doneKeepMinutes: minutesIn(limits.doneKeep, doneKeepUnit),
                  idleEndMinutes: Number(limits.idle),
                  maxConcurrent: Number(limits.concurrent),
                  maxRunsPerTicket: Number(limits.perTicket),
                  autoResumeMax: Number(limits.autoResume),
                })
              }
            >
              Save limits
            </Button>
          </div>
        </SettingsSection>
        {onDeleteProject && (
          <SettingsSection title="Danger zone">
            <DangerZone
              title="Delete project"
              body={deleteProjectBody}
              actionLabel="Delete project"
              onAction={() => setConfirmingDelete(true)}
            />
            <Dialog
              open={confirmingDelete}
              title="Delete project"
              onClose={() => setConfirmingDelete(false)}
              footer={
                <>
                  <Button variant="ghost" onClick={() => setConfirmingDelete(false)}>
                    Cancel
                  </Button>
                  <Button
                    variant="solid-danger"
                    icon="trash"
                    onClick={() => {
                      setConfirmingDelete(false);
                      onDeleteProject();
                    }}
                  >
                    Delete project
                  </Button>
                </>
              }
            >
              <p>{deleteProjectBody}</p>
            </Dialog>
          </SettingsSection>
        )}
      </main>
    </DeskFrame>
  );
}
