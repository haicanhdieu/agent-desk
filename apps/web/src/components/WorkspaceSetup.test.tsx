import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { setupPlugins, setupVersions } from '@/mocks';
import { DeskLayout } from './DeskLayout';
import { PluginList } from './PluginList';
import { SetupPhases } from './SetupPhases';
import { VersionHistory } from './VersionHistory';

describe('PluginList', () => {
  it('splits the id at the last @ and says what happens to each plugin', () => {
    render(<PluginList plugins={setupPlugins.planned} />);
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent('superpowers@claude-plugins-officialWill install');
    expect(items[2]).toHaveTextContent('acme-lint@acme-toolsBlocked: store not approved');
    expect(screen.getByRole('img', { name: 'Blocked' })).toBeInTheDocument();
  });

  it('has empty, loading and error states', () => {
    const { rerender } = render(<PluginList plugins={[]} />);
    expect(screen.getByText(/enables no plugins/)).toBeInTheDocument();
    rerender(<PluginList plugins={[]} loading />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading plugins');
    rerender(<PluginList plugins={[]} error="Could not read settings" />);
    expect(screen.getByText('Could not read settings')).toBeInTheDocument();
  });
});

describe('SetupPhases', () => {
  it('names each phase state, not by colour alone', () => {
    render(
      <SetupPhases
        phases={[
          { label: 'Clone', state: 'done' },
          { label: 'Setup', state: 'failed', detail: 'exit 1' },
        ]}
      />,
    );
    expect(screen.getByRole('list', { name: 'Setup phases' })).toHaveTextContent('CloneSetupexit 1');
    expect(screen.getByRole('img', { name: 'Failed' })).toBeInTheDocument();
  });
});

describe('VersionHistory', () => {
  it('marks the newest as current and offers View and Restore on the others', async () => {
    const onRestore = vi.fn();
    const onView = vi.fn();
    render(<VersionHistory versions={setupVersions} onRestore={onRestore} onView={onView} />);
    expect(screen.getAllByRole('listitem')[0]).toHaveAttribute('aria-current', 'true');
    expect(screen.queryByRole('button', { name: 'Restore version 4' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Restore version 2' }));
    await userEvent.click(screen.getByRole('button', { name: 'View version 3' }));
    expect(onRestore).toHaveBeenCalledWith(2);
    expect(onView).toHaveBeenCalledWith(3);
    expect(screen.getByText('No note')).toBeInTheDocument();
  });
});

describe('DeskLayout setup item', () => {
  const repo = { org: 'harbor-labs', name: 'invoicer-api', branch: 'main', connected: true };
  it('shows Workspace setup only when a setup link is given', () => {
    const { rerender } = render(
      <DeskLayout active="skills" repo={repo} links={{ skills: 's', rules: 'r', agent: 'a' }} />,
    );
    expect(screen.queryByRole('link', { name: 'Workspace setup' })).toBeNull();
    rerender(<DeskLayout active="setup" repo={repo} links={{ skills: 's', rules: 'r', agent: 'a', setup: 'w' }} />);
    expect(screen.getByRole('link', { name: 'Workspace setup' })).toHaveAttribute('href', 'w');
  });
});
