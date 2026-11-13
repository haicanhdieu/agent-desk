import { useState, type ReactNode } from 'react';
import { Banner, Button, Field, Icon, LabelChip, Skeleton, StatusBadge, StatusIcon, TextInput } from '@/ds';
import {
  CodeEditor,
  KeyValue,
  PluginList,
  Section,
  SetupPhases,
  SidePanel,
  Terminal,
  TerminalBar,
  TerminalPane,
  VersionHistory,
  type PluginListProps,
  type ScriptVersion,
  type SetupPhase,
  type TermLine,
} from '@/components';
import styles from './Screens.module.css';
import { DeskFrame, type DeskFrameData } from './DeskFrame';

/** Starter text for a project with no saved script. */
export const SETUP_SCRIPT_STARTER = [
  '# Runs in the repo root after each clone, before the agent starts.',
  '# Non-root user, no system packages. A non-zero exit fails the run.',
  'set -euo pipefail',
  '',
  '',
].join('\n');

export interface SavedSetupScript {
  version: number;
  body: string;
  savedBy: string;
  savedAgo: string;
}

/** The latest finished test, shown when no test workspace is open. */
export interface LastSetupTest {
  result: 'passed' | 'failed';
  /** The test ran exactly the saved script (by hash). */
  matchesSaved: boolean;
  /** "Today 14:22 by kim-hale, 2m 41s. Clone, 2 plugins installed, 1 blocked, setup exited 0." */
  summary: string;
}

/** An open test workspace: the same phases as a run, then an idle shell. */
export interface SetupTestView {
  status: 'running' | 'passed' | 'failed';
  phases: SetupPhase[];
  plugins: PluginListProps['plugins'];
  lines: TermLine[];
  view?: 'log' | 'terminal';
  /** "Draft, 1 line changed from v4" or "Version 4". */
  scriptLabel: string;
  checkout: string;
  started: string;
  /** "13 min" until the workspace is deleted. */
  endsIn: string;
  attachedAs?: string;
  /** Replaces the static terminal (the live terminal relay). */
  terminal?: ReactNode;
}

export interface DeskSetupProps {
  frame: DeskFrameData;
  loading?: boolean;
  loadError?: string;
  /** `null`: the project has no setup script yet. */
  script?: SavedSetupScript | null;
  /** The editor's starting text; defaults to the saved body (or the starter). */
  draft?: string;
  /** 1-based lines marked as changed against the saved version. */
  changedLines?: number[];
  plugins: PluginListProps;
  versions: ScriptVersion[];
  versionsLoading?: boolean;
  /** The version history could not be loaded. */
  versionsError?: string;
  lastTest?: LastSetupTest;
  test?: SetupTestView;
  saving?: boolean;
  /** e.g. the 409 "changed since you opened it". */
  saveError?: string;
  onSave?(body: string, note: string): void;
  onTest?(body: string): void;
  onEndTest?(): void;
  onViewLog?(): void;
  onViewVersion?(version: number): void;
  onRestore?(version: number): void;
}

const testStatus = {
  running: { status: 'running', label: 'Setting up' },
  passed: { status: 'succeeded', label: 'Setup passed' },
  failed: { status: 'failed', label: 'Setup failed' },
} as const;

function LastTestBanner({ lastTest, onViewLog }: { lastTest?: LastSetupTest; onViewLog?(): void }) {
  if (!lastTest) {
    return (
      <Banner tone="off" icon={<Icon name="info" size={16} />} title="Not tested yet">
        Test runs the editor&apos;s script in a throwaway workspace, with the same steps as a real run.
      </Banner>
    );
  }
  const passed = lastTest.result === 'passed';
  const title = passed
    ? lastTest.matchesSaved
      ? 'Last test passed, matches the saved script'
      : 'Last test passed, but the script changed since'
    : 'Last test failed';
  return (
    <Banner
      tone={passed && lastTest.matchesSaved ? 'ok' : passed ? 'warn' : 'err'}
      icon={<StatusIcon status={passed ? 'succeeded' : 'failed'} size={16} />}
      title={title}
      centered
      actions={
        <Button variant="ghost" size="sm" onClick={onViewLog}>
          View log
        </Button>
      }
    >
      {lastTest.summary}
    </Banner>
  );
}

export function DeskSetup({
  frame,
  loading,
  loadError,
  script,
  draft,
  changedLines = [],
  plugins,
  versions,
  versionsLoading,
  versionsError,
  lastTest,
  test,
  saving = false,
  saveError,
  onSave,
  onTest,
  onEndTest,
  onViewLog,
  onViewVersion,
  onRestore,
}: DeskSetupProps) {
  const saved = script?.body ?? '';
  const [value, setValue] = useState(draft ?? (script ? script.body : SETUP_SCRIPT_STARTER));
  const [note, setNote] = useState('');
  const [view, setView] = useState(test?.view ?? 'terminal');
  const dirty = value !== saved;
  const nextVersion = (script?.version ?? 0) + 1;

  if (loading || loadError) {
    return (
      <DeskFrame active="setup" {...frame}>
        <main className={styles.setupDeskMain} aria-busy={loading || undefined}>
          <div className={styles.setupDeskHead}>
            <h2>Workspace setup</h2>
          </div>
          <div className={styles.setupDeskBody}>
            {loadError ? (
              <Banner tone="err" icon={<Icon name="warning" size={16} />} title="Could not load the setup script">
                {loadError}
              </Banner>
            ) : (
              <Skeleton variant="block" height={240} />
            )}
          </div>
        </main>
      </DeskFrame>
    );
  }

  const editor = (
    <CodeEditor
      aria-label="Setup script"
      language="shell"
      value={value}
      onChange={setValue}
      changedLines={changedLines}
    />
  );
  const save = (
    <Button
      variant="primary"
      icon="commit"
      disabled={!dirty || saving}
      aria-busy={saving || undefined}
      onClick={() => onSave?.(value, note)}
    >
      Save version {nextVersion}
    </Button>
  );

  return (
    <DeskFrame active="setup" {...frame}>
      <div className={styles.deskRow}>
        <main className={styles.setupDeskMain}>
          <div className={styles.setupDeskHead}>
            <div className={styles.skillHeadText}>
              <span className={styles.skillTitleRow}>
                <h2>Workspace setup</h2>
                {dirty && script !== null && <LabelChip name="Unsaved changes" tone="idle" />}
              </span>
              <span className={`faint ${styles.skillMeta}`}>
                {script
                  ? test && dirty
                    ? `Editing from version ${script.version}. The test runs this draft; runs keep using version ${script.version} until you save.`
                    : `Version ${script.version}, saved by ${script.savedBy} ${script.savedAgo}. Runs use the saved version; Agent Desk stores it, not your repo.`
                  : 'No setup script: runs start the agent right after cloning.'}
              </span>
            </div>
            {test ? (
              <>
                <Button icon="play" onClick={() => onTest?.(value)}>
                  Test again
                </Button>
                {save}
              </>
            ) : (
              <Button variant="primary" icon="play" onClick={() => onTest?.(value)}>
                Test setup
              </Button>
            )}
          </div>

          {saveError && (
            <div className={styles.setupDeskBanner}>
              <Banner tone="err" icon={<Icon name="warning" size={16} />} title={saveError} live="assertive" />
            </div>
          )}

          {test ? (
            <>
              <div className={styles.setupTestEditor}>{editor}</div>
              <div className={styles.setupPhaseBar}>
                <StatusBadge status={testStatus[test.status].status} variant="pill">
                  {testStatus[test.status].label}
                </StatusBadge>
                <SetupPhases phases={test.phases} />
              </div>
              <TerminalPane
                bar={
                  <TerminalBar
                    views={[
                      { id: 'log', label: 'Log', icon: 'transcript' },
                      { id: 'terminal', label: 'Terminal', icon: 'terminal' },
                    ]}
                    activeView={view}
                    onViewChange={(id) => setView(id === 'log' ? 'log' : 'terminal')}
                    connection={
                      <span className={styles.setupTestMeta}>
                        {test.attachedAs && <span className="muted">Attached as {test.attachedAs}</span>}
                        <span className="faint">Ends in {test.endsIn}</span>
                        <Button variant="danger" size="sm" onClick={onEndTest}>
                          End test
                        </Button>
                      </span>
                    }
                  />
                }
              >
                {test.terminal ?? (
                  <Terminal lines={test.lines} cursor={view === 'terminal'} aria-label="Test workspace terminal" />
                )}
              </TerminalPane>
            </>
          ) : (
            <>
              <div className={styles.setupDeskBanner}>
                <LastTestBanner lastTest={lastTest} onViewLog={onViewLog} />
              </div>
              <p className={styles.setupDeskLabel}>
                Setup script <span className="faint">runs with bash in the repo root, 10 min limit</span>
              </p>
              <div className={styles.setupEditorBox}>{editor}</div>
              <div className={styles.setupSaveBar}>
                <div className={styles.setupSaveRow}>
                  <Field
                    className={styles.grow}
                    label={
                      <>
                        Change note <span className="faint">optional</span>
                      </>
                    }
                  >
                    {({ id }) => (
                      <TextInput
                        id={id}
                        value={note}
                        placeholder="What changed and why"
                        onChange={(e) => setNote(e.target.value)}
                      />
                    )}
                  </Field>
                  <Button
                    variant="ghost"
                    disabled={!dirty || saving}
                    onClick={() => setValue(script ? script.body : SETUP_SCRIPT_STARTER)}
                  >
                    Discard
                  </Button>
                  {save}
                </div>
                <p className={styles.setupSaveNote}>
                  Don&apos;t put passwords or tokens here. Runs that start after you save use the new version; running
                  runs keep theirs.
                </p>
              </div>
            </>
          )}
        </main>

        <SidePanel aria-label={test ? 'Test result' : 'Plugins and history'}>
          {test ? (
            <>
              <Section title="This test">
                <KeyValue
                  items={[
                    { term: 'Script', value: test.scriptLabel },
                    { term: 'Checkout', value: <span className="mono">{test.checkout}</span> },
                    { term: 'Started', value: test.started },
                    { term: 'Credentials', value: 'Repo token only. Claude is not started.' },
                  ]}
                />
              </Section>
              <Section title="Plugins" aside={<span className="faint">this test</span>}>
                <PluginList plugins={test.plugins} />
              </Section>
              <Section title="Limits">
                <Banner tone="warn" icon={<Icon name="warning" size={15} />} title="Private package feeds need secrets">
                  Setup has no secrets or private network yet, so private feeds fail. Use public feeds for now.
                </Banner>
              </Section>
            </>
          ) : (
            <>
              <Section title="Plugins" aside={<span className="faint mono">.claude/settings.json</span>}>
                <PluginList {...plugins} />
                <p className={styles.helpLine}>
                  Only plugins from approved stores install. Approved: Anthropic&apos;s official store.
                </p>
              </Section>
              <Section
                title="Version history"
                aside={
                  <span className="faint">
                    {versions.length} {versions.length === 1 ? 'version' : 'versions'}
                  </span>
                }
              >
                <VersionHistory
                  versions={versions}
                  loading={versionsLoading}
                  error={versionsError}
                  onView={onViewVersion}
                  onRestore={onRestore}
                />
              </Section>
            </>
          )}
        </SidePanel>
      </div>
    </DeskFrame>
  );
}
