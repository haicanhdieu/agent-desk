import { useId, useState } from 'react';
import { Banner, Button, Field, Icon, InlineStatus, RadioCard, SegmentedControl, StatusIcon, TextInput } from '@/ds';
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
  /** Polling mode: result of the first check. Continue waits for a good check. */
  polling?: PollingState;
  accessHref?: string;
  onModeChange?(mode: TriggerMode): void;
  onIntervalChange?(interval: PollInterval): void;
  onRetry?(): void;
}

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
}: Setup1Props) {
  const [repo, setRepo] = useState(selected);
  const [mode, setMode] = useState(initialMode);
  const [interval, setPollEvery] = useState(pollInterval);
  const modeLabelId = useId();
  const intervalLabelId = useId();
  const pickMode = (m: TriggerMode) => { setMode(m); onModeChange?.(m); };
  const pickInterval = (i: PollInterval) => { setPollEvery(i); onIntervalChange?.(i); };
  const waitingForCheck = mode === 'polling' && polling?.state !== 'ok';

  return (
    <SetupLayout
      user={user}
      projectName={projectName}
      steps={setupSteps()}
      current={0}
      stepLabel="Step 1 of 4"
      title="Connect a repository"
      intro="The Agent Desk GitHub App receives issue comments and gives each run a one-hour token for this repository only."
      footer={{ next: { label: 'Continue', href: nextHref, disabled: waitingForCheck } }}
      aside={
        <div className={styles.stack14}>
          <h2 className="h3">Permissions the app asks for</h2>
          <KeyValue items={permissions} termWidth={120} />
          <div className={styles.asideBanner}>
            {mode === 'webhook' ? (
              <Banner tone="warn" icon={<Icon name="warning" size={16} />} title={c.pingHelpTitle}>
                {c.pingHelpBody} <a href="#">{c.pingHelpCheckAgain}</a>{c.pingHelpTail}
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
      <Field label="Project name">
        {({ id }) => <TextInput id={id} defaultValue={projectName} />}
      </Field>
      <div className={styles.stack10}>
        <div className={styles.split}>
          <span className={styles.groupLabel}>GitHub App installation</span>
          <InlineStatus tone="ok" icon={<StatusIcon status="succeeded" size={12} />}>Installed on {installedOn}</InlineStatus>
        </div>
        <div className={styles.stack8} role="radiogroup" aria-label="Repository">
          {repos.map((r) => (
            <RadioCard
              key={r.name}
              type="radio"
              name="repo"
              checked={r.name === repo}
              onChange={() => setRepo(r.name)}
              title={<span className="mono">{r.name}</span>}
              description={r.meta}
              faintDescription
            />
          ))}
        </div>
        <p className={`muted ${styles.helpLine}`}>
          Missing a repository? <a href={accessHref}>Change which repositories the app can access</a> in GitHub, then come back. This list refreshes on its own.
        </p>
      </div>
      <div className={styles.stack10}>
        <span id={modeLabelId} className={styles.groupLabel}>{c.modeLabel}</span>
        <div className={styles.grid2Gap8} role="radiogroup" aria-labelledby={modeLabelId}>
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
