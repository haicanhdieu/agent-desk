import { useState, type ReactNode } from 'react';
import { Banner, Button, Dialog, Field, Icon, Select, TextInput, UnitInput } from '@/ds';
import {
  DangerZone,
  KeyValue,
  SecretField,
  SettingsSection,
  TriggerModeSetting,
  type SecretFieldState,
} from '@/components';
import type { CredentialType } from '@/components';
import { connectionCopy as c, DEFAULT_POLL_INTERVAL } from '@/mocks/connection';
import type { AgentSettings, ConnectionStatus, PollInterval, TriggerMode } from '@/mocks/types';
import styles from './Screens.module.css';
import { DeskFrame, type DeskFrameData } from './DeskFrame';

export type LimitField = 'timeoutMinutes' | 'idleEndMinutes' | 'maxConcurrent' | 'maxRunsPerTicket';
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
  onSaveLimits?(limits: AgentLimits): void;
  /** Per-field messages from a refused limits save; the typed values stay. */
  limitsErrors?: Partial<Record<LimitField, string>>;
  /** A limits save failure that belongs to no field. */
  limitsError?: string;
  /** A limits save is in flight: Save limits stays disabled. */
  savingLimits?: boolean;
  /** The idle limit is shown but cannot be changed here (no API field for it yet). */
  idleReadOnly?: boolean;
  /** Called after the delete is confirmed in a dialog. */
  onDeleteProject?(): void;
  /**
   * Receives the typed replacement token. It is never rendered after submit. Resolving `true` closes the replace
   * panel (saved); otherwise it stays open with `credentialError`.
   */
  onReplaceCredential?(type: CredentialType, value: string): void | Promise<boolean>;
  credentialError?: string;
}

const narrow = { width: 90 };
const deleteBody =
  'Removes rules, run history and the stored credential. Skills stay in the repo. The GitHub App stays installed until you remove it on GitHub.';

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
  onSaveLimits,
  limitsErrors = {},
  limitsError,
  savingLimits = false,
  idleReadOnly = false,
  onDeleteProject,
  onReplaceCredential,
  credentialError,
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
  const [limits, setLimits] = useState({
    timeout: String(settings.timeoutMinutes),
    idle: String(settings.idleEndMinutes),
    concurrent: String(settings.maxConcurrent),
    perTicket: String(settings.maxRunsPerTicket),
  });
  const set = (k: keyof typeof limits) => (e: { target: { value: string } }) =>
    setLimits({ ...limits, [k]: e.target.value });
  const state: SecretFieldState = replacing ? 'replacing' : 'saved';
  const replaceCredential = async (value: string) => {
    if (await onReplaceCredential?.(credType, value)) setReplacing(false);
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
              <Button variant="ghost" size="sm" icon="refresh">
                {c.checkNow}
              </Button>
            )}
          </div>
        </SettingsSection>
        <SettingsSection title="Agent" description="Every run in this project uses this agent and credential.">
          <div className={styles.grid2Gap16}>
            <Field label="Agent" help="Claude Code CLI. Other agents come later.">
              {({ id, describedBy }) => (
                <TextInput id={id} aria-describedby={describedBy} value={settings.agent} disabled readOnly />
              )}
            </Field>
            <Field label="Model">
              {({ id }) => (
                <Select id={id} defaultValue={settings.model}>
                  <option>{settings.model}</option>
                </Select>
              )}
            </Field>
          </div>
          <Field label="Credential" labelAs="span">
            {({ labelId }) => (
              <div role="group" aria-labelledby={labelId}>
                <SecretField
                  state={state}
                  credentialType={credType}
                  onCredentialTypeChange={setCredType}
                  savedInfo={settings.credential.setAt ? settings.credential : undefined}
                  onReplace={() => setReplacing(true)}
                  onCancel={() => setReplacing(false)}
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
              help="Max 55. The repo token expires after 60."
              error={limitsErrors.timeoutMinutes}
            >
              {({ id, describedBy, invalid }) => (
                <UnitInput
                  id={id}
                  aria-describedby={describedBy}
                  aria-invalid={invalid}
                  unit="minutes"
                  value={limits.timeout}
                  onChange={set('timeout')}
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
                  readOnly={idleReadOnly}
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
                  timeoutMinutes: Number(limits.timeout),
                  idleEndMinutes: Number(limits.idle),
                  maxConcurrent: Number(limits.concurrent),
                  maxRunsPerTicket: Number(limits.perTicket),
                })
              }
            >
              Save limits
            </Button>
          </div>
        </SettingsSection>
        <SettingsSection title="Danger zone">
          <DangerZone
            title="Delete project"
            body={deleteBody}
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
                    onDeleteProject?.();
                  }}
                >
                  Delete project
                </Button>
              </>
            }
          >
            <p>{deleteBody}</p>
          </Dialog>
        </SettingsSection>
      </main>
    </DeskFrame>
  );
}
