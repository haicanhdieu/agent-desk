import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DeleteAgentDialog } from './DeleteAgentDialog';

const base = { state: 'confirm' as const, name: 'Claude - Work', onKeep: vi.fn(), onDelete: vi.fn() };
const BODY = 'Rules and runs stop using it. Run history keeps its name.';

describe('DeleteAgentDialog', () => {
  it('confirms with the title, body and both buttons', async () => {
    const onKeep = vi.fn();
    const onDelete = vi.fn();
    render(<DeleteAgentDialog {...base} onKeep={onKeep} onDelete={onDelete} />);
    expect(screen.getByRole('dialog', { name: 'Delete agent Claude - Work?' })).toBeInTheDocument();
    expect(screen.getByText(BODY)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Delete agent' }));
    expect(onDelete).toHaveBeenCalledOnce();
    await userEvent.click(screen.getByRole('button', { name: 'Keep agent' }));
    expect(onKeep).toHaveBeenCalledOnce();
  });

  it('shows Deleting… and cannot be submitted twice or closed while it runs', async () => {
    const onKeep = vi.fn();
    const onDelete = vi.fn();
    render(<DeleteAgentDialog {...base} state="deleting" onKeep={onKeep} onDelete={onDelete} />);
    const button = screen.getByRole('button', { name: 'Deleting…' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
    await userEvent.keyboard('{Escape}');
    expect(onKeep).not.toHaveBeenCalled();
  });

  it('blocked by a rule: the standard text, the reason and only Close', () => {
    render(<DeleteAgentDialog {...base} state="blockedRules" rule={{ count: 1, command: 'fix' }} />);
    expect(screen.getByText(BODY)).toBeInTheDocument();
    expect(screen.getByText('A routing rule uses this agent')).toBeInTheDocument();
    expect(screen.getByText('1 rule names it: fix. Point it at another agent first, then delete.')).toBeInTheDocument();
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['Close']);
  });

  it('blocked by anything else: the headline, the API sentence as text and only Close', () => {
    render(
      <DeleteAgentDialog
        {...base}
        state="blocked"
        reason={{ title: 'This agent has open runs', text: 'A run <b>still</b> uses this agent.' }}
      />,
    );
    expect(screen.getByText('This agent has open runs')).toBeInTheDocument();
    expect(screen.getByText('A run <b>still</b> uses this agent.')).toBeInTheDocument();
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['Close']);
  });

  it('a server error shows the title and request id and keeps both buttons', () => {
    render(<DeleteAgentDialog {...base} state="error" error={{ title: 'Something went wrong', requestId: 'req-9' }} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong');
    expect(screen.getByText('Request ID: req-9')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Keep agent' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete agent' })).toBeEnabled();
  });

  it('shows a hostile name as text', () => {
    render(<DeleteAgentDialog {...base} name="<b>x</b>" />);
    expect(screen.getByRole('dialog', { name: 'Delete agent <b>x</b>?' })).toBeInTheDocument();
    expect(document.querySelector('b')).toBeNull();
  });

  it('returns focus to the opener when it closes', async () => {
    function Host() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Open
          </button>
          {open && <DeleteAgentDialog {...base} onKeep={() => setOpen(false)} />}
        </>
      );
    }
    render(<Host />);
    const opener = screen.getByRole('button', { name: 'Open' });
    await userEvent.click(opener);
    await userEvent.click(screen.getByRole('button', { name: 'Keep agent' }));
    expect(opener).toHaveFocus();
  });
});
