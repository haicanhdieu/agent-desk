import { useState } from 'react';
import { Banner, Button, Icon, StatusIcon } from '@/ds';
import { CodeEditor, PluginList, SetupLayout, type PluginListProps } from '@/components';
import type { Actor } from '@/mocks/types';
import { SETUP_SCRIPT_STARTER } from './DeskSetup';
import { DEFAULT_CREDENTIAL_DETAIL, setupSteps, type SetupNav } from './setupSteps';
import styles from './Screens.module.css';

export type SetupStepTest =
  | { state: 'idle' }
  | { state: 'running'; detail: string }
  | { state: 'passed' | 'failed'; title: string; detail: string };

export interface SetupWorkspaceProps extends SetupNav {
  user: Actor;
  projectName: string;
  repo: string;
  credentialDetail?: string;
  /** The editor's starting text; defaults to the starter. */
  script?: string;
  plugins: PluginListProps;
  test?: SetupStepTest;
  saving?: boolean;
  saveError?: string;
  onTest?(body: string): void;
  onOpenTerminal?(): void;
  onViewLog?(): void;
  onEndTest?(): void;
  /** Saves the script as version 1 and moves on. With it, the primary button is a button instead of the `nextHref` link. */
  onContinue?(body: string): void;
  onSkip?(): void;
}

function TestResult({
  test,
  onOpenTerminal,
  onViewLog,
  onEndTest,
}: {
  test: SetupStepTest;
  onOpenTerminal?(): void;
  onViewLog?(): void;
  onEndTest?(): void;
}) {
  if (test.state === 'idle') return null;
  if (test.state === 'running') {
    return (
      <Banner
        tone="off"
        icon={<StatusIcon status="running" size={16} />}
        title="Testing in a throwaway workspace"
        live="polite"
      >
        {test.detail}
      </Banner>
    );
  }
  const passed = test.state === 'passed';
  return (
    <Banner
      tone={passed ? 'ok' : 'err'}
      icon={<StatusIcon status={passed ? 'succeeded' : 'failed'} size={16} />}
      title={test.title}
      actionsPlacement="below"
      actions={
        <>
          <Button size="sm" onClick={onViewLog}>
            View log
          </Button>
          <Button size="sm" icon="terminal" onClick={onOpenTerminal}>
            Open terminal
          </Button>
          <Button variant="ghost" size="sm" onClick={onEndTest}>
            End test
          </Button>
        </>
      }
    >
      {test.detail}
    </Banner>
  );
}

/** Onboarding step "Prepare workspace": the same editor, plugins and Test as the Desk Setup tab. */
export function SetupWorkspace({
  user,
  projectName,
  repo,
  credentialDetail = DEFAULT_CREDENTIAL_DETAIL,
  script = SETUP_SCRIPT_STARTER,
  plugins,
  test = { state: 'idle' },
  saving,
  saveError,
  backHref = '#',
  skipHref = '#',
  nextHref = '#',
  onTest,
  onOpenTerminal,
  onViewLog,
  onEndTest,
  onContinue,
  onSkip,
}: SetupWorkspaceProps) {
  const [value, setValue] = useState(script);
  return (
    <SetupLayout
      user={user}
      projectName={projectName}
      steps={setupSteps({ repo, credential: credentialDetail, withWorkspace: true })}
      current={2}
      stepLabel="Step 3 of 5, optional"
      title="Prepare the workspace"
      intro={
        <>
          Commands that run in the repo root after each clone, before the agent starts, such as installing dependencies.
          Agent Desk stores the script and keeps every version; nothing is committed to your repo.
        </>
      }
      footer={{
        back: backHref,
        skip: skipHref,
        onSkip,
        next: onContinue
          ? { label: 'Save and continue', onClick: () => onContinue(value), pending: saving }
          : { label: 'Save and continue', href: nextHref },
      }}
      aside={
        <Banner tone="off" icon={<Icon name="info" size={16} />} title="What setup can do">
          <p className={styles.readyIntro}>
            It runs as a non-root user in the runner image, which has Node 22, git and gh. Install other tools in your
            home folder. No system packages, Docker or services, and no secrets yet, so private package feeds fail.
          </p>
          <p className={styles.asideBanner}>
            A test runs the same steps as a real run. A failing test warns you but does not block going live.
          </p>
        </Banner>
      }
    >
      {saveError && <Banner tone="err" icon={<Icon name="warning" size={16} />} title={saveError} live="assertive" />}
      <div className={styles.setupPluginsCard}>
        <span className={styles.onText}>
          Plugins enabled in <span className="mono">.claude/settings.json</span>
        </span>
        <PluginList {...plugins} />
      </div>
      <div className={styles.stack6}>
        <span className={styles.groupLabel}>
          Setup script <span className="faint">bash, 10 min limit</span>
        </span>
        <div className={styles.setupStepEditor}>
          <CodeEditor aria-label="Setup script" language="shell" value={value} onChange={setValue} />
        </div>
        <span className={`muted ${styles.helpLine}`}>Don&apos;t put passwords or tokens here.</span>
      </div>
      <TestResult test={test} onOpenTerminal={onOpenTerminal} onViewLog={onViewLog} onEndTest={onEndTest} />
      <div className={styles.actions}>
        <Button icon="play" onClick={() => onTest?.(value)} disabled={test.state === 'running'}>
          {test.state === 'idle' ? 'Test setup' : 'Test again'}
        </Button>
      </div>
    </SetupLayout>
  );
}
