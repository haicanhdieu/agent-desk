import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { agentRowViews, agentRowView, agentsFixture } from '@/mocks';
import type { AgentRowView } from '@/mocks/types';
import { AgentRow, type AgentRowProps } from './AgentRow';

const view = (name: string): AgentRowView => {
  const a = agentsFixture.find((x) => x.name === name);
  if (!a) throw new Error(`no fixture ${name}`);
  return agentRowView(a);
};
const claudeDefault = view('Claude - Personal');
const claudeWork = view('Claude - Work');
const openCodeNone = view('OpenCode - No sign-in');
const claudeNew = view('Claude - New');

function renderRow(agent: AgentRowView, props: Partial<AgentRowProps> = {}) {
  const handlers = { onEdit: vi.fn(), onTest: vi.fn(), onSetDefault: vi.fn(), onDelete: vi.fn() };
  const utils = render(
    <ul>
      <AgentRow agent={agent} {...handlers} {...props} />
    </ul>,
  );
  return { ...handlers, ...utils };
}
const menu = (name: string) => screen.getByRole('button', { name: `Actions for ${name}` });

describe('AgentRow', () => {
  it('keeps the provider name next to the logo, with the unchanged accessible names', () => {
    const { container } = renderRow(claudeWork);
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByText('Claude - Work')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit Claude - Work' })).toBeInTheDocument();
    expect(menu('Claude - Work')).toHaveAttribute('aria-haspopup');
    expect(menu('Claude - Work')).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByText(claudeWork.detail)).toBeInTheDocument();
    expect(screen.getByText(claudeWork.model)).toHaveClass('model');
    expect(screen.getByText('Credential rejected')).toBeInTheDocument();
  });

  it('marks the default with the text chip and offers no Set as default on it', async () => {
    renderRow(claudeDefault);
    expect(screen.getByText('Default')).toBeInTheDocument();
    await userEvent.click(menu(claudeDefault.name));
    expect(screen.getByRole('button', { name: 'Test connection' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Set as default' })).toBeNull();
  });

  it('a non-default row has no chip and offers Set as default', async () => {
    const { onSetDefault } = renderRow(claudeWork);
    expect(screen.queryByText('Default')).toBeNull();
    await userEvent.click(menu(claudeWork.name));
    await userEvent.click(screen.getByRole('button', { name: 'Set as default' }));
    expect(onSetDefault).toHaveBeenCalledWith(claudeWork);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('Edit and Test connection call back with the agent', async () => {
    const { onEdit, onTest } = renderRow(claudeWork);
    await userEvent.click(screen.getByRole('button', { name: 'Edit Claude - Work' }));
    expect(onEdit).toHaveBeenCalledWith(claudeWork);
    await userEvent.click(menu(claudeWork.name));
    await userEvent.click(screen.getByRole('button', { name: 'Test connection' }));
    expect(onTest).toHaveBeenCalledWith(claudeWork);
  });

  it('Delete works on a non-default agent when it is not the only one', async () => {
    const { onDelete } = renderRow(claudeWork);
    await userEvent.click(menu(claudeWork.name));
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onDelete).toHaveBeenCalledWith(claudeWork);
  });

  it('disables Delete on the default with its reason', async () => {
    const { onDelete } = renderRow(claudeDefault);
    await userEvent.click(menu(claudeDefault.name));
    const del = screen.getByRole('button', { name: 'Delete (set another default first)' });
    expect(del).toBeDisabled();
    await userEvent.click(del);
    expect(onDelete).not.toHaveBeenCalled();
  });

  it('disables Delete on the only agent with its own reason', async () => {
    renderRow(claudeDefault, { onlyAgent: true });
    await userEvent.click(menu(claudeDefault.name));
    expect(screen.getByRole('button', { name: 'Delete (a project needs at least one agent)' })).toBeDisabled();
  });

  it('read-only rows show View and no menu', () => {
    const { onEdit } = renderRow(claudeWork, { readOnly: true });
    expect(screen.queryByRole('button', { name: /^Actions for/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Edit/ })).toBeNull();
    screen.getByRole('button', { name: 'View' }).click();
    expect(onEdit).toHaveBeenCalledWith(claudeWork);
  });

  it('a busy row disables its menu', () => {
    renderRow(claudeWork, { busy: true });
    expect(menu(claudeWork.name)).toBeDisabled();
  });

  it('a testing row shows Testing… and cannot start another test', async () => {
    renderRow(claudeWork, { testing: true });
    expect(screen.getByText('Testing…')).toBeInTheDocument();
    expect(screen.queryByText('Credential rejected')).toBeNull();
    await userEvent.click(menu(claudeWork.name));
    expect(screen.getByRole('button', { name: 'Test connection' })).toBeDisabled();
  });

  it('truncates a 256-character name with a title and shows markup as text', () => {
    const long = 'n'.repeat(256);
    renderRow({ ...claudeWork, name: long });
    expect(screen.getByText(long)).toHaveAttribute('title', long);
    renderRow({ ...claudeWork, id: 'x', name: '<b>x</b>' });
    expect(screen.getByText('<b>x</b>')).toHaveAttribute('title', '<b>x</b>');
    expect(document.querySelector('b')).toBeNull();
  });

  it('an unknown tone from the row view still renders its text', () => {
    renderRow({ ...claudeWork, status: { tone: 'weird' as never, text: "Can't verify" } });
    expect(screen.getByText("Can't verify")).toBeInTheDocument();
  });

  it('an OpenCode row with no credential reads No credential and OpenCode . No sign-in, never amber', () => {
    const { container } = renderRow(openCodeNone);
    expect(screen.getByText('OpenCode . No sign-in')).toBeInTheDocument();
    const status = screen.getByText('No credential').parentElement as HTMLElement;
    expect(status.className).toContain('off');
    expect(status.className).not.toMatch(/warn|idle|late/);
    expect(container).not.toHaveTextContent('Needs credential');
  });

  it('a Claude Code row with no credential reads Needs credential', () => {
    renderRow(claudeNew);
    expect(screen.getByText('Needs credential')).toBeInTheDocument();
  });

  it.each(['OpenCode . Credentials file', 'OpenCode . API endpoint and key', 'OpenCode . No sign-in'])(
    'shows the OpenCode subline %s',
    (line) => {
      renderRow(agentRowViews.find((r) => r.detail === line) ?? openCodeNone);
      expect(screen.getByText(line)).toBeInTheDocument();
    },
  );

  it('the menu has the three actions', async () => {
    renderRow(claudeWork);
    await userEvent.click(menu(claudeWork.name));
    const pop = screen.getByRole('dialog', { name: 'Actions for Claude - Work' });
    expect(
      within(pop)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['Test connection', 'Set as default', 'Delete']);
  });
});
