import { useState, type ReactNode } from 'react';
import { Button, Field, Select, TextInput, UnitInput } from '@/ds';
import { DangerZone, KeyValue, SecretField, SettingsSection, TriggerModeSetting, type SecretFieldState } from '@/components';
import type { CredentialType } from '@/components';
import { connectionCopy as c, DEFAULT_POLL_INTERVAL } from '@/mocks/connection';
import type { AgentSettings, ConnectionStatus, PollInterval, TriggerMode } from '@/mocks/types';
import styles from './Screens.module.css';
import { DeskFrame, type DeskFrameData } from './DeskFrame';

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
  onTriggerChange?(trigger: { mode: TriggerMode; interval: PollInterval }): void;
  onSaveLimits?(limits: { timeoutMinutes: number; idleEndMinutes: number; maxConcurrent: number; maxRunsPerTicket: number }): void;
  onDeleteProject?(): void;
  /** Receives the typed replacement token. It is never rendered after submit. */
  onReplaceCredential?(type: CredentialType, value: string): void;
}

const narrow = { width: 90 };

export function DeskAgent({
  frame, settings, github, replacingCredential = false, connection, pollInterval = DEFAULT_POLL_INTERVAL, onTriggerChange,
  onSaveLimits, onDeleteProject, onReplaceCredential,
}: DeskAgentProps) {
  const [mode, setMode] = useState<TriggerMode>(connection?.mode ?? 'webhook');
  const [interval, setPollEvery] = useState(pollInterval);
  const pick = (next: { mode: TriggerMode; interval: PollInterval }) => {
    setMode(next.mode); setPollEvery(next.interval); onTriggerChange?.(next);
  };
  // The trigger mode row sits right after Repository, as on the board.
  const triggerRow = {
    term: c.triggerModeTerm,
    value: <TriggerModeSetting mode={mode} interval={interval} onChange={pick} />,
  };
  const at = github.findIndex((g) => g.term === 'Repository') + 1 || github.length;
  const items = [...github.slice(0, at), triggerRow, ...github.slice(at)];
  const [replacing, setReplacing] = useState(replacingCredential);
  const [credType, setCredType] = useState<CredentialType>(settings.credential.type);
  const [limits, setLimits] = useState({
    timeout: String(settings.timeoutMinutes), idle: String(settings.idleEndMinutes),
    concurrent: String(settings.maxConcurrent), perTicket: String(settings.maxRunsPerTicket),
  });
  const set = (k: keyof typeof limits) => (e: { target: { value: string } }) => setLimits({ ...limits, [k]: e.target.value });
  const state: SecretFieldState = replacing ? 'replacing' : 'saved';
  return (
    <DeskFrame active="agent" {...frame} connection={connection ?? frame.connection}>
      <main className={styles.agentMain}>
        <h1>Agent &amp; settings</h1>
        <SettingsSection title="GitHub connection" description="Where commands come from and where agents write.">
          <KeyValue termWidth={150} items={items} />
          <div className={styles.deskActions}>
            <Button size="sm" icon="external" href="https://github.com/">Manage installation on GitHub</Button>
            {mode === 'webhook'
              ? <Button variant="ghost" size="sm" icon="refresh">Send test ping</Button>
              : <Button variant="ghost" size="sm" icon="refresh">{c.checkNow}</Button>}
          </div>
        </SettingsSection>
        <SettingsSection title="Agent" description="Every run in this project uses this agent and credential.">
          <div className={styles.grid2Gap16}>
            <Field label="Agent" help="Claude Code CLI. Other agents come later.">
              {({ id, describedBy }) => <TextInput id={id} aria-describedby={describedBy} value={settings.agent} disabled readOnly />}
            </Field>
            <Field label="Model">
              {({ id }) => <Select id={id} defaultValue={settings.model}><option>{settings.model}</option></Select>}
            </Field>
          </div>
          <Field label="Credential" labelAs="span">
            {({ labelId }) => (
              <div role="group" aria-labelledby={labelId}>
              <SecretField
                state={state}
                credentialType={credType}
                onCredentialTypeChange={setCredType}
                savedInfo={settings.credential}
                onReplace={() => setReplacing(true)}
                onCancel={() => setReplacing(false)}
                onSubmit={(value) => onReplaceCredential?.(credType, value)}
              />
              </div>
            )}
          </Field>
        </SettingsSection>
        <SettingsSection title="Limits" description="Guards against runaway cost and stuck runs.">
          <div className={`${styles.grid2Gap16} ${styles.limitsGrid}`}>
            <Field label="Run time limit" help="Max 55. The repo token expires after 60.">
              {({ id, describedBy }) => <UnitInput id={id} aria-describedby={describedBy} unit="minutes" value={limits.timeout} onChange={set('timeout')} />}
            </Field>
            <Field label="End idle runs after" help="Only counts while no terminal is open.">
              {({ id, describedBy }) => <UnitInput id={id} aria-describedby={describedBy} unit="minutes unattended" value={limits.idle} onChange={set('idle')} />}
            </Field>
            <Field label="Concurrent runs" help="Idle runs count. Extra runs wait in the queue.">
              {({ id, describedBy }) => <TextInput numeric id={id} aria-describedby={describedBy} inputMode="numeric" style={narrow} value={limits.concurrent} onChange={set('concurrent')} />}
            </Field>
            <Field label="Runs per ticket" help="Stops runaway chains. Further commands are ignored.">
              {({ id, describedBy }) => <TextInput numeric id={id} aria-describedby={describedBy} inputMode="numeric" style={narrow} value={limits.perTicket} onChange={set('perTicket')} />}
            </Field>
          </div>
          <div className={styles.actionsEnd}>
            <Button
              variant="primary"
              onClick={() => onSaveLimits?.({
                timeoutMinutes: Number(limits.timeout), idleEndMinutes: Number(limits.idle),
                maxConcurrent: Number(limits.concurrent), maxRunsPerTicket: Number(limits.perTicket),
              })}
            >
              Save limits
            </Button>
          </div>
        </SettingsSection>
        <SettingsSection title="Danger zone">
          <DangerZone
            title="Delete project"
            body="Removes rules, run history and the stored credential. Skills stay in the repo. The GitHub App stays installed until you remove it on GitHub."
            actionLabel="Delete project"
            onAction={onDeleteProject}
          />
        </SettingsSection>
      </main>
    </DeskFrame>
  );
}
