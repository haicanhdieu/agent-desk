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

describe('VersionHistory on a later page', () => {
  const page2 = [3, 2, 1].map((version) => ({ version, author: 'kim-hale', ago: 'a day ago' }));
  it('marks no row current when the current version is not on the page, and offers Restore on all rows', () => {
    render(<VersionHistory versions={page2} currentVersion={23} />);
    for (const row of screen.getAllByRole('listitem')) expect(row).not.toHaveAttribute('aria-current');
    expect(screen.queryByText(/· current/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Restore version 3' })).toBeInTheDocument();
  });
  it('marks the row of the current version', () => {
    render(<VersionHistory versions={page2} currentVersion={2} />);
    expect(screen.getAllByRole('listitem')[1]).toHaveAttribute('aria-current', 'true');
    expect(screen.getAllByRole('listitem')[0]).not.toHaveAttribute('aria-current');
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
