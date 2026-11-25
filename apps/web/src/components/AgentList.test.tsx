import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { agentRowViews } from '@/mocks';
import { AgentList, type AgentListProps } from './AgentList';

const pagination = {
  page: 1,
  pageSize: 20 as const,
  total: agentRowViews.length,
  onPageChange: vi.fn(),
  onPageSizeChange: vi.fn(),
};

function setup(props: Partial<AgentListProps> = {}) {
  const handlers = {
    onAdd: vi.fn(),
    onRetry: vi.fn(),
    onEdit: vi.fn(),
    onTest: vi.fn(),
    onSetDefault: vi.fn(),
    onDelete: vi.fn(),
  };
  render(<AgentList rows={agentRowViews} state="ready" pagination={pagination} {...handlers} {...props} />);
  return handlers;
}

describe('AgentList', () => {
  it('shows the heading, both description lines, Add agent and one row per agent', () => {
    setup();
    expect(screen.getByRole('heading', { name: 'Agents' })).toBeInTheDocument();
    expect(
      screen.getByText('Configure the agent runtimes and accounts available to this project.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('The default agent runs a command when its routing rule does not pick an agent.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add agent' })).toBeInTheDocument();
    expect(within(screen.getByRole('list')).getAllByRole('listitem')).toHaveLength(agentRowViews.length);
  });

  it('shows exactly one Default and Set as default on every other row but not that one', async () => {
    setup();
    expect(screen.getAllByText('Default')).toHaveLength(1);
    const items = screen.getAllByRole('listitem');
    const defaultItem = items.find((li) => within(li).queryByText('Default'));
    if (!defaultItem) throw new Error('no default row');
    await userEvent.click(within(defaultItem).getByRole('button', { name: /^Actions for/ }));
    expect(screen.queryByRole('button', { name: 'Set as default' })).toBeNull();
  });

  it('shows skeleton rows labelled Loading agents and no rows while loading', () => {
    setup({ rows: [], state: 'loading' });
    expect(screen.getByRole('status', { name: 'Loading agents' })).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryAllByRole('listitem').length).toBe(3);
    expect(screen.queryByRole('button', { name: /^Edit/ })).toBeNull();
  });

  it('shows the empty text and its own Add agent button', async () => {
    const { onAdd } = { onAdd: vi.fn() };
    setup({ rows: [], state: 'empty', onAdd });
    expect(screen.getByText('No agents yet')).toBeInTheDocument();
    expect(screen.getByText(/The first one you add becomes the project default\./)).toBeInTheDocument();
    const adds = screen.getAllByRole('button', { name: 'Add agent' });
    expect(adds).toHaveLength(1);
    await userEvent.click(adds[0]);
    expect(onAdd).toHaveBeenCalledOnce();
  });

  it('shows the load error with the request id and a working Retry, and no rows', async () => {
    const onRetry = vi.fn();
    setup({ rows: [], state: 'error', onRetry, error: { requestId: 'req-3' } });
    expect(screen.getByRole('alert')).toHaveTextContent('Could not load the agents. Try again.');
    expect(screen.getByText('Request ID: req-3')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledOnce();
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
  });

  it('pins Pagination under the rows when the list is paged', () => {
    setup({ pagination: { ...pagination, page: 2, total: 24 }, rows: agentRowViews.slice(0, 4) });
    const nav = screen.getByRole('navigation', { name: 'Pagination' });
    expect(nav).toHaveTextContent('21–24');
    expect(screen.getAllByRole('list')[0].compareDocumentPosition(nav) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('treats a single agent as the only one: Delete is disabled with that reason', async () => {
    setup({ rows: agentRowViews.slice(0, 1), pagination: { ...pagination, total: 1 } });
    await userEvent.click(screen.getByRole('button', { name: /^Actions for/ }));
    expect(screen.getByRole('button', { name: 'Delete (a project needs at least one agent)' })).toBeDisabled();
  });

  it('read-only: View on rows, no menu and no Add agent', () => {
    setup({ readOnly: true });
    expect(screen.queryByRole('button', { name: 'Add agent' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Actions for/ })).toBeNull();
    expect(screen.getAllByRole('button', { name: 'View' })).toHaveLength(agentRowViews.length);
  });

  it('passes busy and testing to the matching row only', () => {
    setup({ busyId: agentRowViews[1].id, testingId: agentRowViews[2].id });
    expect(screen.getByRole('button', { name: `Actions for ${agentRowViews[1].name}` })).toBeDisabled();
    expect(screen.getByRole('button', { name: `Actions for ${agentRowViews[0].name}` })).toBeEnabled();
    expect(screen.getAllByText('Testing…')).toHaveLength(1);
  });
});
