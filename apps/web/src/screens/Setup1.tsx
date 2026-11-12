import { useId, useState, type MouseEvent } from 'react';
import { AppLink, Banner, Button, Field, Icon, InlineStatus, RadioCard, SegmentedControl, StatusIcon, TextInput } from '@/ds';
import { KeyValue, SetupLayout } from '@/components';
import { connectionCopy as c, DEFAULT_POLL_INTERVAL, pollIntervals } from '@/mocks/connection';
import type { Actor, PollInterval, TriggerMode } from '@/mocks/types';
import { setupSteps, type SetupNav } from './setupSteps';
import styles from './Screens.module.css';

/** Polling progress once the user picks Polling. There is no ping or relay to wait for. */
export type PollingState =
  | { state: 'checking' }
  | { state: 'ok'; lastChecked: string }
  | { state: 'failed'; reason: string };

/** What Continue saves. */
export interface Setup1Draft {
  name: string;
  repo: string;
  mode: TriggerMode;
  interval: PollInterval;
}

export interface Setup1Props extends SetupNav {
  user: Actor;
  projectName: string;
  repos: { name: string; meta: string }[];
  selected: string;
  installedOn: string;
  /** Initial trigger mode. Defaults to webhook. */
  mode?: TriggerMode;
  /** Initial polling interval. Defaults to 5 min. */
  pollInterval?: PollInterval;
  /** Webhook mode: time the ping arrived. */
  pingAt?: string;
  /** Polling mode: result of the first check, once the project exists. When given, Continue waits for a good check; before the project is saved there is none and Continue (which creates it) stays enabled. */
  polling?: PollingState;
  accessHref?: string;
  onModeChange?(mode: TriggerMode): void;
  onIntervalChange?(interval: PollInterval): void;
  onRetry?(): void;
  /** Press "Check again" in the ping help (webhook mode). */
  onCheckAgain?(): void;
  /** Install the GitHub App or change its repositories; shown as "Connect GitHub" when there are no repositories. */
  onConnect?(): void;
  /** Saves the step. With it, Continue is a button instead of the `nextHref` link. */
  onContinue?(draft: Setup1Draft): void;
  saving?: boolean;
  errors?: { name?: string; repo?: string; mode?: string };
  /** A failed save that names no field. */
  formError?: string;
}

/** Last path segment of a repo, the default project name. */
const repoTail = (repo: string) => repo.split('/').at(-1) ?? repo;

const permissions = [
  { term: 'Contents', value: 'Read and write' },
  { term: 'Issues', value: 'Read and write' },
  { term: 'Pull requests', value: 'Read and write' },
  { term: 'Metadata', value: 'Read' },
  { term: 'Events', value: 'Issue comment' },
];

const modes: TriggerMode[] = ['webhook', 'polling'];

export function Setup1({
  user, projectName, repos, selected, installedOn, mode: initialMode = 'webhook', pollInterval = DEFAULT_POLL_INTERVAL,
  pingAt, polling, nextHref = '#', accessHref = 'https://github.com/', onModeChange, onIntervalChange, onRetry,
  onCheckAgain, onConnect, onContinue, saving, errors, formError,
}: Setup1Props) {
  const [repo, setRepo] = useState(selected);
  const [mode, setMode] = useState(initialMode);
  const [interval, setPollEvery] = useState(pollInterval);
  const [name, setName] = useState(projectName);
  // The name follows the picked repo until the user types one.
  const [nameEdited, setNameEdited] = useState(false);
  const modeLabelId = useId();
  const intervalLabelId = useId();
  const repoErrorId = useId();
  const modeErrorId = useId();
  const pickMode = (m: TriggerMode) => { setMode(m); onModeChange?.(m); };
  const pickInterval = (i: PollInterval) => { setPollEvery(i); onIntervalChange?.(i); };
  const pickRepo = (r: string) => { setRepo(r); if (!nameEdited) setName(repoTail(r)); };
  // Polling progress exists only once the project is saved; before that Continue is what starts the first check.
  const waitingForCheck = mode === 'polling' && polling !== undefined && polling.state !== 'ok';
  const action = (fn: (() => void) | undefined) => (e: MouseEvent) => {
    if (!fn) return;
    e.preventDefault();
    fn();
  };
  const noRepos = repos.length === 0;

  return (
    <SetupLayout
      user={user}
      projectName={name || projectName}
      steps={setupSteps()}
      current={0}
      stepLabel="Step 1 of 4"
      title="Connect a repository"
      intro="The Agent Desk GitHub App receives issue comments and gives each run a one-hour token for this repository only."
      footer={{
        next: onContinue
          ? {
            label: 'Continue',
            onClick: () => onContinue({ name, repo, mode, interval }),
            disabled: waitingForCheck || noRepos,
            pending: saving,
          }
          : { label: 'Continue', href: nextHref, disabled: waitingForCheck },
      }}
      aside={
        <div className={styles.stack14}>
          <h2 className="h3">Permissions the app asks for</h2>
          <KeyValue items={permissions} termWidth={120} />
          <div className={styles.asideBanner}>
            {mode === 'webhook' ? (
              <Banner tone="warn" icon={<Icon name="warning" size={16} />} title={c.pingHelpTitle}>
                {c.pingHelpBody} <AppLink href="#" onClick={action(onCheckAgain)}>{c.pingHelpCheckAgain}</AppLink>{c.pingHelpTail}
              </Banner>
            ) : (
              <Banner tone="off" icon={<Icon name="info" size={16} />} title={c.pollingCostTitle}>
                {c.pollingCostBody}
              </Banner>
            )}
          </div>
        </div>
      }
    >
      {formError && <Banner tone="err" icon={<Icon name="warning" size={16} />} title={formError} live="assertive" />}
      <Field label="Project name" error={errors?.name}>
        {({ id, describedBy, invalid }) => (
          <TextInput
            id={id} aria-describedby={describedBy} aria-invalid={invalid} value={name}
            onChange={(e) => { setName(e.target.value); setNameEdited(true); }}
          />
        )}
      </Field>
      <div className={styles.stack10}>
        <div className={styles.split}>
          <span className={styles.groupLabel}>GitHub App installation</span>
          {installedOn && <InlineStatus tone="ok" icon={<StatusIcon status="succeeded" size={12} />}>Installed on {installedOn}</InlineStatus>}
        </div>
        {noRepos && (
          <Banner
            tone="off"
            icon={<Icon name="info" size={16} />}
            title="No repositories yet"
            actions={onConnect && <Button variant="primary" size="sm" onClick={onConnect}>Connect GitHub</Button>}
          >
            Install the Agent Desk GitHub App on the account that owns the repository, then come back.
          </Banner>
        )}
        <div
          className={styles.stack8} role="radiogroup" aria-label="Repository" hidden={noRepos}
          aria-describedby={errors?.repo ? repoErrorId : undefined} aria-invalid={errors?.repo ? true : undefined}
        >
          {repos.map((r) => (
            <RadioCard
              key={r.name}
              type="radio"
              name="repo"
              checked={r.name === repo}
              onChange={() => pickRepo(r.name)}
              title={<span className="mono">{r.name}</span>}
              description={r.meta}
              faintDescription
            />
          ))}
        </div>
        {errors?.repo && <span id={repoErrorId} className={styles.fieldError}>{errors.repo}</span>}
        <p className={`muted ${styles.helpLine}`}>
          Missing a repository? <a href={accessHref} onClick={action(onConnect)}>Change which repositories the app can access</a> in GitHub, then come back. This list refreshes on its own.
        </p>
      </div>
      <div className={styles.stack10}>
        <span id={modeLabelId} className={styles.groupLabel}>{c.modeLabel}</span>
        <div
          className={styles.grid2Gap8} role="radiogroup" aria-labelledby={modeLabelId}
          aria-describedby={errors?.mode ? modeErrorId : undefined} aria-invalid={errors?.mode ? true : undefined}
        >
          {modes.map((m) => (
            <RadioCard
              key={m}
              type="radio"
              name="trigger-mode"
              checked={m === mode}
              onChange={() => pickMode(m)}
              title={c.modes[m].title}
              description={c.modes[m].description}
              faintDescription
            />
          ))}
        </div>
        {errors?.mode && <span id={modeErrorId} className={styles.fieldError}>{errors.mode}</span>}
        {mode === 'polling' && (
          <div className={styles.intervalRow}>
            <span id={intervalLabelId} className={styles.intervalLabel}>{c.intervalLabel}</span>
            <SegmentedControl
              aria-labelledby={intervalLabelId}
              value={interval}
              options={pollIntervals.map((i) => ({ value: i, label: i }))}
              onChange={pickInterval}
            />
            <span className={`muted ${styles.helpLine}`}>{c.modeLaterHelp}</span>
          </div>
        )}
      </div>
      {mode === 'webhook' && pingAt && (
        <Banner tone="ok" icon={<StatusIcon status="succeeded" size={16} />} title={c.pingReceived(pingAt)}>
          {c.pingReceivedBody}
        </Banner>
      )}
      {mode === 'polling' && polling?.state === 'checking' && (
        <Banner tone="off" icon={<StatusIcon status="starting" size={16} />} iconColor="var(--run)" title={c.pollingChecking}>
          {c.pollingCheckingBody}
        </Banner>
      )}
      {mode === 'polling' && polling?.state === 'ok' && (
        <Banner tone="ok" icon={<StatusIcon status="succeeded" size={16} />} title={c.pollingChecked(interval, polling.lastChecked)}>
          {c.pollingCheckedBody(interval)}
        </Banner>
      )}
      {mode === 'polling' && polling?.state === 'failed' && (
        <Banner
          tone="err"
          icon={<Icon name="warning" size={16} />}
          title={c.pollingFailed(polling.reason)}
          actions={<Button size="sm" icon="refresh" onClick={onRetry}>{c.retryNow}</Button>}
        >
          {c.pollingFailedBody}
        </Banner>
      )}
    </SetupLayout>
  );
}
