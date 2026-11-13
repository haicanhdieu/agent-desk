import { render, screen } from '@testing-library/react';
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
import { SetupWorkspace } from './SetupWorkspace';
import { RunDetail } from './RunDetail';

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
    await userEvent.type(screen.getByLabelText('Setup script'), '\ndotnet build');
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

  it('warns when the last pass was on an older script', () => {
    render(<DeskSetup {...props} lastTest={{ result: 'passed', matchesSaved: false, summary: 'On version 3.' }} />);
    expect(screen.getByText('Last test passed, but the script changed since')).toBeInTheDocument();
  });

  it('without a script, starts from the starter and saves version 1', () => {
    render(<DeskSetup {...props} script={null} versions={[]} />);
    expect(screen.getByText(/No setup script: runs start the agent right after cloning/)).toBeInTheDocument();
    expect(screen.getByLabelText('Setup script')).toHaveValue(SETUP_SCRIPT_STARTER);
    expect(screen.getByRole('button', { name: 'Save version 1' })).toBeEnabled();
  });

  it('an open test shows phases, the terminal and End test', async () => {
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
          endsIn: '13 min',
        }}
      />,
    );
    expect(screen.getByText('Setup failed')).toBeInTheDocument();
    expect(screen.getByRole('log', { name: 'Test workspace terminal' })).toHaveTextContent(
      'agentdesk: setup failed exit=1',
    );
    expect(screen.getByText('Repo token only. Claude is not started.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'End test' }));
    expect(onEndTest).toHaveBeenCalled();
  });

  it('has loading and error states', () => {
    const { rerender } = render(<DeskSetup {...props} loading />);
    expect(screen.getByRole('main')).toHaveAttribute('aria-busy', 'true');
    rerender(<DeskSetup {...props} loadError="Server down" />);
    expect(screen.getByText('Could not load the setup script')).toBeInTheDocument();
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
    render(<RunDetail data={runDetails.RunSetupFailed} lines={terminalByRun[58]} needsYou={1} />);
    expect(screen.getAllByText('Setup failed').length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: 'Version 5' })).toBeInTheDocument();
    expect(screen.getByText(/Setup failed after 52s/)).toBeInTheDocument();
  });
});
