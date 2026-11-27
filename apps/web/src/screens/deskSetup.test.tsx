import type { ReactElement } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
  deskFrame,
  runDetails,
  setupPhases,
  setupPlugins,
  setupScript,
  setupTestTerminal,
  setupVersions,
  terminalByRun,
  user,
} from '@/mocks';
import { DeskSetup, SETUP_SCRIPT_STARTER, type DeskSetupProps } from './DeskSetup';
import type { DeskSetupEnvironmentProps } from './DeskSetupEnvironment';
import type { PaginationProps } from '@/components';
import { SetupWorkspace } from './SetupWorkspace';
import { RunDetail } from './RunDetail';
import { ProjectShellFrame } from './projectShellFrame';
import { expectShellOwnedPage, headerActions } from '@/test/shellAssert';

const props: DeskSetupProps = {
  frame: deskFrame,
  script: { version: 4, body: setupScript, savedBy: 'kim-hale', savedAgo: '2 days ago' },
  plugins: { plugins: setupPlugins.planned },
  versions: setupVersions,
};

describe('DeskSetup', () => {
  it('saves a new version only after an edit, with the note', async () => {
    const onSave = vi.fn();
    render(<DeskSetup {...props} onSave={onSave} />);
    const save = screen.getByRole('button', { name: 'Save version 5' });
    expect(save).toBeDisabled();
    await userEvent.type(screen.getByRole('textbox', { name: 'Setup script' }), '\ndotnet build');
    await userEvent.type(screen.getByLabelText(/Change note/), 'Build once');
    expect(save).toBeEnabled();
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    await userEvent.click(save);
    expect(onSave).toHaveBeenCalledWith(`${setupScript}\ndotnet build`, 'Build once');
  });

  it('tests the editor draft, not the saved script', async () => {
    const onTest = vi.fn();
    render(<DeskSetup {...props} draft="echo draft" onTest={onTest} />);
    await userEvent.click(screen.getByRole('button', { name: 'Test setup' }));
    expect(onTest).toHaveBeenCalledWith('echo draft');
  });

  it('shows why the version history is missing instead of the empty copy', () => {
    render(<DeskSetup {...props} versions={[]} versionsError="Could not load the version history." />);
    expect(screen.getByText('Could not load the version history.')).toBeInTheDocument();
    expect(screen.queryByText(/No versions yet/)).not.toBeInTheDocument();
  });

  it('warns when the last test ended without a result', () => {
    render(
      <DeskSetup {...props} lastTest={{ result: 'ended', matchesSaved: false, summary: 'Today 14:22 by kim.' }} />,
    );
    expect(screen.getByText('Last test ended without a result')).toBeInTheDocument();
    expect(screen.getByText(/could not start/i)).toBeInTheDocument();
  });

  it('warns when the last pass was on an older script', () => {
    render(<DeskSetup {...props} lastTest={{ result: 'passed', matchesSaved: false, summary: 'On version 3.' }} />);
    expect(screen.getByText('Last test passed, but the script changed since')).toBeInTheDocument();
  });

  it('without a script, starts from the starter and saves version 1', () => {
    render(<DeskSetup {...props} script={null} versions={[]} />);
    expect(screen.getByText(/No setup script: runs start the agent right after cloning/)).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Setup script' })).toHaveValue(SETUP_SCRIPT_STARTER);
    expect(screen.getByRole('button', { name: 'Save version 1' })).toBeEnabled();
  });
  it('splits the column between the editor and the log only when fitting the window; a board keeps its fixed editor', () => {
    const test = {
      status: 'failed' as const,
      phases: setupPhases.failed,
      plugins: setupPlugins.result,
      lines: setupTestTerminal,
      scriptLabel: 'Draft',
      checkout: 'main a91c3e2',
      started: '14:31',
    };
    const editorBox = () => screen.getByRole('textbox', { name: 'Setup script' }).closest('[class*="setupTestEditor"]');
    const { rerender } = render(<DeskSetup {...props} test={test} />);
    expect(editorBox()?.className).not.toMatch(/Fit/);
    rerender(<DeskSetup {...props} height="viewport" test={test} />);
    expect(editorBox()?.className).toMatch(/Fit/);
  });

  it('a test in flight shows phases, the log and End test', async () => {
    const onEndTest = vi.fn();
    render(
      <DeskSetup
        {...props}
        onEndTest={onEndTest}
        test={{
          status: 'failed',
          phases: setupPhases.failed,
          plugins: setupPlugins.result,
          lines: setupTestTerminal,
          scriptLabel: 'Draft',
          checkout: 'main a91c3e2',
          started: '14:31',
        }}
      />,
    );
    expect(screen.getByText('Setup failed')).toBeInTheDocument();
    expect(screen.getByRole('log', { name: 'Test workspace terminal' })).toHaveTextContent(
      'agentdesk: setup failed exit=1',
    );
    expect(
      screen.getByText("Repo token and this project's environment values. Claude is not started."),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'End test' }));
    expect(onEndTest).toHaveBeenCalled();
  });

  describe('log actions', () => {
    const testView = {
      status: 'failed' as const,
      phases: setupPhases.failed,
      plugins: setupPlugins.result,
      lines: setupTestTerminal,
      scriptLabel: 'Draft',
      checkout: 'main a91c3e2',
      started: '14:31',
    };
    const logText = setupTestTerminal.map((line) => line.map((s) => s.text).join('')).join('\n');

    it('Copy all puts the whole log on the clipboard and says so', async () => {
      const ue = userEvent.setup();
      render(<DeskSetup {...props} test={testView} />);
      await ue.click(screen.getByRole('button', { name: 'Copy all' }));
      expect(await navigator.clipboard.readText()).toBe(logText);
      expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument();
    });

    it('Copy all says when the clipboard is not available', async () => {
      const ue = userEvent.setup();
      render(<DeskSetup {...props} test={testView} />);
      vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('denied'));
      await ue.click(screen.getByRole('button', { name: 'Copy all' }));
      expect(await screen.findByRole('button', { name: 'Copy failed' })).toBeInTheDocument();
    });

    it('Find opens a search box that marks every match in the log and steps through them', async () => {
      const ue = userEvent.setup();
      render(<DeskSetup {...props} test={testView} />);
      expect(screen.queryByRole('searchbox', { name: 'Find in log' })).not.toBeInTheDocument();
      await ue.click(screen.getByRole('button', { name: 'Find in scrollback' }));
      const box = screen.getByRole('searchbox', { name: 'Find in log' });
      expect(box).toHaveFocus();
      await ue.type(box, 'setup');
      const log = screen.getByRole('log', { name: 'Test workspace terminal' });
      const count = log.querySelectorAll('mark').length;
      expect(count).toBeGreaterThan(1);
      expect(screen.getByText(`1 of ${count}`)).toBeInTheDocument();
      expect(log.querySelectorAll('mark')[0]).toHaveAttribute('aria-current', 'true');
      await ue.click(screen.getByRole('button', { name: 'Next match' }));
      expect(screen.getByText(`2 of ${count}`)).toBeInTheDocument();
      expect(log.querySelectorAll('mark')[1]).toHaveAttribute('aria-current', 'true');
      await ue.click(screen.getByRole('button', { name: 'Previous match' }));
      expect(screen.getByText(`1 of ${count}`)).toBeInTheDocument();
    });

    it('Find ignores case, says when nothing matches, and closes with the log left unmarked', async () => {
      const ue = userEvent.setup();
      render(<DeskSetup {...props} test={testView} />);
      await ue.click(screen.getByRole('button', { name: 'Find in scrollback' }));
      const box = screen.getByRole('searchbox', { name: 'Find in log' });
      await ue.type(box, 'AGENT-DESK RUNNER');
      const log = screen.getByRole('log', { name: 'Test workspace terminal' });
      expect(log.querySelectorAll('mark')).toHaveLength(1);
      await ue.clear(box);
      await ue.type(box, 'no such text');
      expect(screen.getByText('No matches')).toBeInTheDocument();
      expect(log.querySelectorAll('mark')).toHaveLength(0);
      await ue.click(screen.getByRole('button', { name: 'Close find' }));
      expect(screen.queryByRole('searchbox', { name: 'Find in log' })).not.toBeInTheDocument();
    });
  });

  it('a failed setup shows what failed above the log, and no shell tab or countdown', () => {
    render(
      <DeskSetup
        {...props}
        test={{
          status: 'failed',
          phases: setupPhases.failed,
          plugins: setupPlugins.result,
          lines: setupTestTerminal,
          scriptLabel: 'Draft',
          checkout: 'main a91c3e2',
          started: '14:31',
          failure: {
            title: 'Setup script failed: exit 127 (command not found)',
            detail: 'Line 11 of the script: sudo x.',
          },
        }}
      />,
    );
    expect(screen.getByText('Setup script failed: exit 127 (command not found)')).toBeInTheDocument();
    expect(screen.getByText('Line 11 of the script: sudo x.')).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Terminal' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Ends in/)).not.toBeInTheDocument();
    expect(screen.queryByText('Shell')).not.toBeInTheDocument();
  });

  it('has loading and error states', () => {
    const { rerender } = render(<DeskSetup {...props} loading />);
    expect(screen.getByRole('main')).toHaveAttribute('aria-busy', 'true');
    rerender(<DeskSetup {...props} loadError="Server down" />);
    expect(screen.getByText('Could not load the setup script')).toBeInTheDocument();
  });

  it('fits the window in the loading and error states when asked to', () => {
    const shell = () => screen.getByRole('main').closest('[class*="appViewport"]');
    const { rerender } = render(<DeskSetup {...props} height="viewport" loading />);
    expect(shell()).not.toBeNull();
    rerender(<DeskSetup {...props} height="viewport" loadError="Server down" />);
    expect(shell()).not.toBeNull();
    rerender(<DeskSetup {...props} loadError="Server down" />);
    expect(shell()).toBeNull();
  });
});

describe('SetupWorkspace', () => {
  it('is step 3 of 5 and saves the editor text on continue', async () => {
    const onContinue = vi.fn();
    render(
      <SetupWorkspace
        user={user}
        projectName="invoicer-api"
        repo="harbor-labs/invoicer-api"
        plugins={{ plugins: [] }}
        script="echo hi"
        onContinue={onContinue}
      />,
    );
    expect(screen.getByText('Step 3 of 5, optional')).toBeInTheDocument();
    expect(screen.getByText('Prepare workspace')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Save and continue' }));
    expect(onContinue).toHaveBeenCalledWith('echo hi');
  });
});

describe('RunDetail setup failed', () => {
  it('labels the run Setup failed and links the setup version', () => {
    render(<RunDetail data={runDetails.RunSetupFailed} lines={terminalByRun[58]} links={{ setup: '/desk/setup' }} />);
    expect(screen.getAllByText('Setup failed').length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: 'Version 5' })).toHaveAttribute('href', '/desk/setup');
    expect(screen.getByText(/Setup failed after 52s/)).toBeInTheDocument();
  });

  it('shows the setup version as plain text without a setup link (the caller may not open the Desk)', () => {
    render(<RunDetail data={runDetails.RunSetupFailed} lines={terminalByRun[58]} />);
    expect(screen.queryByRole('link', { name: 'Version 5' })).not.toBeInTheDocument();
    expect(screen.getByText('Version 5')).toBeInTheDocument();
  });
});

describe('DeskSetup version history paging', () => {
  const versionsPagination: PaginationProps = {
    page: 2,
    pageSize: 20,
    total: 23,
    onPageChange: () => undefined,
    onPageSizeChange: () => undefined,
  };

  it('the header counts versionsTotal, not the rows shown', () => {
    render(
      <DeskSetup
        {...props}
        versions={setupVersions.slice(0, 3)}
        versionsTotal={23}
        versionsPagination={versionsPagination}
      />,
    );
    expect(screen.getByText('23 versions')).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Pagination' })).toBeInTheDocument();
  });

  it('no control while versions load, fail or are empty', () => {
    const { rerender } = render(<DeskSetup {...props} versionsLoading versionsPagination={versionsPagination} />);
    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByRole('navigation', { name: 'Pagination' })).toBeNull();
    rerender(
      <DeskSetup
        {...props}
        versions={[]}
        versionsError="Could not load the version history. Reload to try again."
        versionsPagination={versionsPagination}
      />,
    );
    expect(screen.getByText('Could not load the version history. Reload to try again.')).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Pagination' })).toBeNull();
    rerender(
      <DeskSetup {...props} versions={[]} versionsTotal={0} versionsPagination={{ ...versionsPagination, total: 0 }} />,
    );
    expect(screen.getByText('0 versions')).toBeInTheDocument();
    expect(screen.getByText('No versions yet. The first save creates version 1.')).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Pagination' })).toBeNull();
  });
});

const environment = (vars: boolean, secrets: boolean, testRunning?: boolean): DeskSetupEnvironmentProps => ({
  variables: { entries: [{ name: 'DB_HOST', value: 'db.internal' }], total: 1, canWrite: vars },
  secrets: { entries: [{ name: 'NPM_TOKEN', meta: 'Set 2 days ago by kim-hale' }], total: 1, canWrite: secrets },
  testRunning,
});
const runningTest = {
  status: 'running' as const,
  phases: setupPhases.failed,
  plugins: setupPlugins.result,
  lines: setupTestTerminal,
  scriptLabel: 'Draft',
  checkout: 'main a91c3e2',
  started: '14:31',
};
const READ_ONLY = 'You can see these but not change them.';

describe('DeskSetup tabs and Environment', () => {
  it('has a tab strip with Setup script selected by default', () => {
    render(<DeskSetup {...props} environment={environment(true, true)} />);
    expect(screen.getByRole('tab', { name: 'Setup script' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Environment' })).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByRole('textbox', { name: 'Setup script' })).toBeInTheDocument();
  });

  it('names the variables and secrets pagination landmarks apart when neither caller passes a label', async () => {
    const paged: PaginationProps = {
      page: 1,
      pageSize: 20,
      total: 45,
      onPageChange: () => undefined,
      onPageSizeChange: () => undefined,
    };
    const env = environment(true, true);
    render(
      <DeskSetup
        {...props}
        environment={{
          ...env,
          variables: { ...env.variables, total: 45, pagination: paged },
          secrets: { ...env.secrets, total: 45, pagination: paged },
        }}
      />,
    );
    await userEvent.click(screen.getByRole('tab', { name: 'Environment' }));
    expect(screen.getByRole('navigation', { name: 'Variables pagination' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Secrets pagination' })).toBeInTheDocument();
  });

  it('rewords the save note to point at secrets', () => {
    render(<DeskSetup {...props} />);
    expect(
      screen.getByText(
        "Don't put passwords or tokens here. Add them as secrets on the Environment tab. Runs that start after you save use the new version; running runs keep theirs.",
      ),
    ).toBeInTheDocument();
  });

  it('rewords the Limits banner of a test', () => {
    render(<DeskSetup {...props} test={runningTest} />);
    expect(screen.getByText('Private package feeds need a secret')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Add it on the Environment tab. Setup has no private network yet, so only feeds reachable from the internet work.',
      ),
    ).toBeInTheDocument();
  });

  it('shows both groups with intro, help texts and the visibility note', () => {
    render(<DeskSetup {...props} tab="environment" environment={environment(true, true)} />);
    expect(
      screen.getByText(/^Every run and setup test in this project gets these as environment variables\./),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Environment variables' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Secrets' })).toBeInTheDocument();
    expect(
      screen.getByText('Plain values are shown in full and are not hidden in logs. Put anything sensitive in Secrets.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'Write-only. After you save, a value is hidden for good: you can replace or remove it, not read it back.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'Setup scripts and the agent can read these values. Run output shows them as ***, but keep each secret to what this project needs.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add variable' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add secret' })).toBeInTheDocument();
    expect(screen.queryByText(READ_ONLY)).not.toBeInTheDocument();
    expect(screen.queryByText(/A test is running/)).not.toBeInTheDocument();
  });

  it('with no write permission shows one note under the intro and no controls', () => {
    render(<DeskSetup {...props} tab="environment" environment={environment(false, false)} />);
    expect(screen.getAllByText(READ_ONLY)).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Add variable' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add secret' })).not.toBeInTheDocument();
  });

  it('with only the secrets read-only keeps variable controls and notes the Secrets group', () => {
    render(<DeskSetup {...props} tab="environment" environment={environment(true, false)} />);
    expect(screen.getAllByText(READ_ONLY)).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Add variable' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add secret' })).not.toBeInTheDocument();
  });

  it('with only the variables read-only keeps secret controls and no note', () => {
    render(<DeskSetup {...props} tab="environment" environment={environment(false, true)} />);
    expect(screen.queryByText(READ_ONLY)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add variable' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add secret' })).toBeInTheDocument();
  });

  it('says a test is running only while one runs', () => {
    const line = 'A test is running. It keeps the values it started with.';
    const { rerender } = render(<DeskSetup {...props} tab="environment" environment={environment(true, true, true)} />);
    expect(screen.getByText(line)).toBeInTheDocument();
    rerender(<DeskSetup {...props} tab="environment" environment={environment(true, true, false)} />);
    expect(screen.queryByText(line)).not.toBeInTheDocument();
  });

  it('keeps a typed script draft across a switch to Environment and back', async () => {
    const ue = userEvent.setup();
    render(<DeskSetup {...props} environment={environment(true, true)} />);
    await ue.type(screen.getByRole('textbox', { name: 'Setup script' }), '\necho kept');
    await ue.click(screen.getByRole('tab', { name: 'Environment' }));
    expect(screen.getByRole('heading', { name: 'Secrets' })).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Setup script' })).not.toBeInTheDocument();
    await ue.click(screen.getByRole('tab', { name: 'Setup script' }));
    expect(screen.getByRole('textbox', { name: 'Setup script' })).toHaveValue(`${setupScript}\necho kept`);
  });

  it('reports the chosen tab and follows a controlled tab', async () => {
    const onTabChange = vi.fn();
    render(<DeskSetup {...props} tab="script" onTabChange={onTabChange} environment={environment(true, true)} />);
    await userEvent.click(screen.getByRole('tab', { name: 'Environment' }));
    expect(onTabChange).toHaveBeenCalledWith('environment');
    expect(screen.getByRole('textbox', { name: 'Setup script' })).toBeInTheDocument();
  });
});

describe('DeskSetup in the shell', () => {
  const menu = 'Project menu';
  const inShell = (ui: ReactElement) =>
    render(
      <ProjectShellFrame page="setup" fill>
        {ui}
      </ProjectShellFrame>,
    );

  it('draws one main with the h1 Workspace setup, the version line and Test setup in the header', () => {
    inShell(<DeskSetup {...props} />);
    const main = expectShellOwnedPage('Workspace setup', { menu });
    const header = screen.getByRole('heading', { level: 1 }).closest('header')!;
    expect(within(header).getByText(/Version 4, saved by kim-hale 2 days ago/)).toBeInTheDocument();
    expect(within(headerActions(main)).getByRole('button', { name: 'Test setup' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 2, name: 'Workspace setup' })).toBeNull();
  });

  it('in test mode with a changed script the header carries Test again, Save, the edit line and the chip', async () => {
    const test = {
      status: 'failed' as const,
      phases: setupPhases.failed,
      plugins: setupPlugins.result,
      lines: setupTestTerminal,
      scriptLabel: 'Draft',
      checkout: 'main a91c3e2',
      started: '14:31',
    };
    inShell(<DeskSetup {...props} test={test} />);
    await userEvent.type(screen.getByRole('textbox', { name: 'Setup script' }), '\necho changed');
    const main = expectShellOwnedPage('Workspace setup', { menu });
    const header = screen.getByRole('heading', { level: 1 }).closest('header')!;
    expect(within(header).getByText(/Editing from version 4/)).toBeInTheDocument();
    expect(within(header).getByText('Unsaved changes')).toBeInTheDocument();
    const actions = within(headerActions(main));
    expect(actions.getByRole('button', { name: 'Test again' })).toBeInTheDocument();
    expect(actions.getByRole('button', { name: 'Save version 5' })).toBeEnabled();
    expect(actions.queryByRole('button', { name: 'Test setup' })).toBeNull();
  });

  it('loading keeps one main', () => {
    inShell(<DeskSetup {...props} loading />);
    expect(screen.getAllByRole('main')).toHaveLength(1);
  });

  it('the setup page shows no setup warning banner even when the frame has one', () => {
    inShell(
      <DeskSetup
        {...props}
        frame={{ ...deskFrame, warning: { title: 'Workspace setup needs attention', detail: 'x', href: '#setup' } }}
      />,
    );
    expect(screen.queryByText('Workspace setup needs attention')).toBeNull();
  });
});
