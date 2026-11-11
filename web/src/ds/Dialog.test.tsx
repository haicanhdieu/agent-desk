import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Dialog } from './Dialog';

function Harness({ onClose = () => {} }: { onClose?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ position: 'relative' }}>
      <button onClick={() => setOpen(true)}>Open</button>
      <Dialog open={open} title="Delete it?" onClose={() => { onClose(); setOpen(false); }}
        footer={<><button>Cancel</button><button>Confirm</button></>}>
        <input aria-label="Name" />
      </Dialog>
    </div>
  );
}

describe('Dialog', () => {
  it('renders nothing when closed', () => {
    render(<Dialog open={false} title="T" onClose={() => {}}>x</Dialog>);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('is a modal dialog named by its h2 title, absolutely positioned (no portal)', () => {
    const { container } = render(<Dialog open title="Delete it?" onClose={() => {}}>x</Dialog>);
    const dlg = screen.getByRole('dialog', { name: 'Delete it?' });
    expect(dlg).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByRole('heading', { level: 2, name: 'Delete it?' })).toBeInTheDocument();
    expect(container.contains(dlg)).toBe(true);
    expect(dlg.parentElement).toHaveClass('overlay');
  });

  it('opened by keyboard: focus moves in, Escape closes once, focus returns to opener', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    const opener = screen.getByRole('button', { name: 'Open' });
    opener.focus();
    await user.keyboard('{Enter}');
    const dlg = screen.getByRole('dialog');
    expect(dlg.contains(document.activeElement)).toBe(true);
    expect(screen.getByLabelText('Name')).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(opener).toHaveFocus();
  });

  it('Tab from the last control wraps to the first, Shift+Tab the reverse', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Open' }));
    screen.getByRole('button', { name: 'Confirm' }).focus();
    await user.tab();
    expect(screen.getByLabelText('Name')).toHaveFocus();
    await user.tab({ shift: true });
    expect(screen.getByRole('button', { name: 'Confirm' })).toHaveFocus();
  });

  it('Escape works when focus is on body after clicking the scrim or dialog text', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Dialog open title="Delete it?" onClose={onClose}>x</Dialog>);
    await user.click(screen.getByRole('heading', { name: 'Delete it?' }));
    (document.activeElement as HTMLElement).blur();
    expect(document.body).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('dialog').parentElement as HTMLElement);
    (document.activeElement as HTMLElement).blur();
    expect(document.body).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('removes the listener on unmount', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const { unmount } = render(<Dialog open title="T" onClose={onClose}>x</Dialog>);
    unmount();
    await user.keyboard('{Escape}');
    expect(onClose).not.toHaveBeenCalled();
  });
});
