import { useState, type ReactNode } from 'react';
import {
  Banner,
  Button,
  Dialog,
  DurationInput,
  Field,
  Icon,
  LabelChip,
  Skeleton,
  TextInput,
  UnitInput,
  minutesIn,
  splitMinutes,
} from '@/ds';
import {
  AgentList,
  AgentPane,
  DangerZone,
  DeleteAgentDialog,
  KeyValue,
  SettingsSection,
  TriggerModeSetting,
  type AgentListProps,
  type AgentPaneProps,
  type DeleteAgentDialogProps,
} from '@/components';
import { connectionCopy as c } from '@/mocks/connection';
import type { PollInterval, TriggerMode } from '@/mocks/types';
import styles from './Screens.module.css';
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

type DurationUnit = ReturnType<typeof splitMinutes>['unit'];

/** The one scroll area of a tab: focusable and named, so a keyboard user can scroll it. */
function PanelScroll({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={styles.agentScroll} role="region" aria-label={label} tabIndex={0}>
      {children}
    </div>
  );
}

/** The Agents tab: the list (heading, rows, Pagination) beside the add or edit pane, and the delete dialog. */
export function AgentsPanel({
  list,
  pane,
  deleteDialog,
}: {
  list: AgentListProps;
  pane?: AgentPaneProps;
  deleteDialog?: DeleteAgentDialogProps;
}) {
  return (
    <>
      <div className={styles.agentsRow}>
        <div className={styles.agentsCol}>
          <AgentList {...list} />
        </div>
        {pane && <AgentPane {...pane} />}
      </div>
      {deleteDialog && <DeleteAgentDialog {...deleteDialog} />}
    </>
  );
}

export interface GitHubPanelProps {
  /** `loading` and `error` replace the rows; the other tabs are unaffected. */
  state?: 'ready' | 'loading' | 'error';
  error?: { requestId?: string };
  onRetry?(): void;
  items: { term: string; value: ReactNode }[];
  mode: TriggerMode;
  interval: PollInterval;
  onTriggerChange(next: { mode: TriggerMode; interval: PollInterval }): void;
  triggerError?: string;
  onCheckNow?(): void;
  checkingNow?: boolean;
  checkNowError?: string;
}

/** The GitHub connection tab: where commands come from and where agents write. */
export function GitHubPanel({
  state = 'ready',
  error,
  onRetry,
  items,
  mode,
  interval,
  onTriggerChange,
  triggerError,
  onCheckNow,
  checkingNow = false,
  checkNowError,
}: GitHubPanelProps) {
  // The trigger mode row sits right after Repository, as on the board.
  const triggerRow = {
    term: c.triggerModeTerm,
    value: <TriggerModeSetting mode={mode} interval={interval} onChange={onTriggerChange} error={triggerError} />,
  };
  const at = items.findIndex((g) => g.term === 'Repository') + 1 || items.length;
  const rows = [...items.slice(0, at), triggerRow, ...items.slice(at)];
  return (
    <PanelScroll label="GitHub connection">
      <SettingsSection nested title="GitHub connection" description="Where commands come from and where agents write.">
        {state === 'loading' && (
          <div role="status" aria-label="Loading the connection" aria-busy="true" className={styles.agentLoading}>
            <Skeleton variant="text" lines={4} width="70%" />
          </div>
        )}
        {state === 'error' && (
          <Banner
            tone="err"
            icon={<Icon name="warning" size={16} />}
            live="assertive"
            actions={<Button onClick={onRetry}>Retry</Button>}
          >
            <span>Could not load the connection. Try again.</span>
            {error?.requestId && <span className="mono">Request ID: {error.requestId}</span>}
          </Banner>
        )}
        {state === 'ready' && (
          <>
            <KeyValue termWidth={150} items={rows} />
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
          </>
        )}
      </SettingsSection>
    </PanelScroll>
  );
}

/** The limits as the person is editing them. Lives in the screen, so a tab switch keeps unsaved edits. */
export function useLimitsForm(initial: AgentLimits) {
  const [units, setUnits] = useState<Record<'timeout' | 'pausedKeep' | 'doneKeep', DurationUnit>>(() => ({
    timeout: splitMinutes(initial.timeoutMinutes).unit,
    pausedKeep: splitMinutes(initial.pausedKeepMinutes).unit,
    doneKeep: splitMinutes(initial.doneKeepMinutes).unit,
  }));
  const [values, setValues] = useState({
    timeout: splitMinutes(initial.timeoutMinutes).value,
    pausedKeep: splitMinutes(initial.pausedKeepMinutes).value,
    doneKeep: splitMinutes(initial.doneKeepMinutes).value,
    idle: String(initial.idleEndMinutes),
    concurrent: String(initial.maxConcurrent),
    perTicket: String(initial.maxRunsPerTicket),
    autoResume: String(initial.autoResumeMax),
  });
  return {
    units,
    values,
    setUnit: (k: keyof typeof units) => (unit: DurationUnit) => setUnits({ ...units, [k]: unit }),
    set: (k: keyof typeof values) => (e: { target: { value: string } }) =>
      setValues({ ...values, [k]: e.target.value }),
    toLimits: (): AgentLimits => ({
      timeoutMinutes: minutesIn(values.timeout, units.timeout),
      pausedKeepMinutes: minutesIn(values.pausedKeep, units.pausedKeep),
      doneKeepMinutes: minutesIn(values.doneKeep, units.doneKeep),
      idleEndMinutes: Number(values.idle),
      maxConcurrent: Number(values.concurrent),
      maxRunsPerTicket: Number(values.perTicket),
      autoResumeMax: Number(values.autoResume),
    }),
  };
}

export interface LimitsPanelProps {
  form: ReturnType<typeof useLimitsForm>;
  onSave?(limits: AgentLimits): void;
  /** Per-field messages from a refused save; the typed values stay. */
  errors?: Partial<Record<LimitField, string>>;
  /** A save failure that belongs to no field. */
  error?: string;
  saving?: boolean;
  /** The reader may see the limits but not change them. */
  readOnly?: boolean;
}

const narrow = { width: 90 };

/** The Limits tab: the five run-lifecycle limits and the three counters, project-wide. */
export function LimitsPanel({ form, onSave, errors = {}, error, saving = false, readOnly = false }: LimitsPanelProps) {
  const { values, units, set, setUnit } = form;
  return (
    <>
      <PanelScroll label="Limits">
        <SettingsSection
          nested
          title="Limits"
          description="Applies to every agent in this project."
          badge={<LabelChip name="Project-wide" />}
        >
          <fieldset disabled={readOnly} className={styles.limitsFields}>
            <div className={`${styles.grid2Gap16} ${styles.limitsGrid}`}>
              <Field
                label="Run time limit"
                help="From 1 minute to 7 days. The repo token is renewed while the run lasts."
                error={errors.timeoutMinutes}
              >
                {({ id, describedBy, invalid }) => (
                  <DurationInput
                    id={id}
                    aria-describedby={describedBy}
                    aria-invalid={invalid}
                    unitLabel="Run time limit unit"
                    unit={units.timeout}
                    onUnitChange={setUnit('timeout')}
                    value={values.timeout}
                    onChange={set('timeout')}
                  />
                )}
              </Field>
              <Field
                label="Keep a paused run for"
                help="After this, a paused run expires and its saved session is deleted."
                error={errors.pausedKeepMinutes}
              >
                {({ id, describedBy, invalid }) => (
                  <DurationInput
                    id={id}
                    aria-describedby={describedBy}
                    aria-invalid={invalid}
                    unitLabel="Keep a paused run for unit"
                    unit={units.pausedKeep}
                    onUnitChange={setUnit('pausedKeep')}
                    value={values.pausedKeep}
                    onChange={set('pausedKeep')}
                  />
                )}
              </Field>
              <Field
                label="Keep a finished run's session for"
                help="How long a finished run can be reopened. 0 turns this off."
                error={errors.doneKeepMinutes}
              >
                {({ id, describedBy, invalid }) => (
                  <DurationInput
                    id={id}
                    aria-describedby={describedBy}
                    aria-invalid={invalid}
                    unitLabel="Keep a finished run's session for unit"
                    unit={units.doneKeep}
                    onUnitChange={setUnit('doneKeep')}
                    value={values.doneKeep}
                    onChange={set('doneKeep')}
                  />
                )}
              </Field>
              <Field
                label="End idle runs after"
                help="Only counts while no terminal is open."
                error={errors.idleEndMinutes}
              >
                {({ id, describedBy, invalid }) => (
                  <UnitInput
                    id={id}
                    aria-describedby={describedBy}
                    aria-invalid={invalid}
                    unit="minutes unattended"
                    value={values.idle}
                    onChange={set('idle')}
                  />
                )}
              </Field>
              <Field
                label="Concurrent runs"
                help="Idle runs count. Extra runs wait in the queue."
                error={errors.maxConcurrent}
              >
                {({ id, describedBy, invalid }) => (
                  <TextInput
                    numeric
                    id={id}
                    aria-describedby={describedBy}
                    aria-invalid={invalid}
                    inputMode="numeric"
                    style={narrow}
                    value={values.concurrent}
                    onChange={set('concurrent')}
                  />
                )}
              </Field>
              <Field
                label="Runs per ticket"
                help="Stops runaway chains. Further commands are ignored."
                error={errors.maxRunsPerTicket}
              >
                {({ id, describedBy, invalid }) => (
                  <TextInput
                    numeric
                    id={id}
                    aria-describedby={describedBy}
                    aria-invalid={invalid}
                    inputMode="numeric"
                    style={narrow}
                    value={values.perTicket}
                    onChange={set('perTicket')}
                  />
                )}
              </Field>
              <Field
                label="Automatic resumes after a crash"
                help="How many times in a row a run resumes by itself after its pod is killed or the agent crashes. Typing in the terminal or pressing Resume starts the count again. 0 turns it off."
                error={errors.autoResumeMax}
              >
                {({ id, describedBy, invalid }) => (
                  <TextInput
                    numeric
                    id={id}
                    aria-describedby={describedBy}
                    aria-invalid={invalid}
                    inputMode="numeric"
                    style={narrow}
                    value={values.autoResume}
                    onChange={set('autoResume')}
                  />
                )}
              </Field>
            </div>
          </fieldset>
          {error && <Banner tone="err" icon={<Icon name="warning" size={16} />} title={error} live="assertive" />}
        </SettingsSection>
      </PanelScroll>
      {!readOnly && (
        <div className={styles.agentSaveBar}>
          <Button
            variant="primary"
            disabled={saving}
            aria-busy={saving || undefined}
            onClick={() => onSave?.(form.toLimits())}
          >
            Save limits
          </Button>
        </div>
      )}
    </>
  );
}

/** The Danger zone tab: Delete project, behind a confirm dialog. */
export function DangerPanel({ onDeleteProject }: { onDeleteProject(): void }) {
  const [confirming, setConfirming] = useState(false);
  return (
    <PanelScroll label="Danger zone">
      <SettingsSection nested title="Danger zone">
        <DangerZone
          title="Delete project"
          body={deleteProjectBody}
          actionLabel="Delete project"
          onAction={() => setConfirming(true)}
        />
        <Dialog
          open={confirming}
          title="Delete project"
          onClose={() => setConfirming(false)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setConfirming(false)}>
                Cancel
              </Button>
              <Button
                variant="solid-danger"
                icon="trash"
                onClick={() => {
                  setConfirming(false);
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
    </PanelScroll>
  );
}
