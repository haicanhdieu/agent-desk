import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Drawer } from './Drawer';

function Harness({ onClose = () => {} }: { onClose?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button onClick={() => setOpen(true)}>Open menu</button>
      <Drawer
        open={open}
        label="Main menu"
        onClose={() => {
          onClose();
          setOpen(false);
        }}
      >
        <a href="/a">First</a>
        <a href="/b">Last</a>
      </Drawer>
    </div>
  );
}

describe('Drawer', () => {
  it('renders nothing when closed', () => {
    render(
      <Drawer open={false} label="Main menu" onClose={() => {}}>
        x
      </Drawer>,
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('is a modal dialog named by its label', () => {
    render(
      <Drawer open label="Main menu" onClose={() => {}}>
        <a href="/a">First</a>
      </Drawer>,
    );
    const dlg = screen.getByRole('dialog', { name: 'Main menu' });
    expect(dlg).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByRole('link', { name: 'First' })).toBeInTheDocument();
  });

  it('traps focus: Tab from the last control wraps to the first', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Open menu' }));
    screen.getByRole('link', { name: 'Last' }).focus();
    await user.tab();
    expect(screen.getByRole('link', { name: 'First' })).toHaveFocus();
  });

  it('Escape calls onClose once and focus returns to the opener', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    const opener = screen.getByRole('button', { name: 'Open menu' });
    opener.focus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('link', { name: 'First' })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(opener).toHaveFocus();
  });

  it('a press on the scrim calls onClose once; a press inside the panel does not', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <Drawer open label="Main menu" onClose={onClose}>
        <a href="/a">First</a>
      </Drawer>,
    );
    await user.click(screen.getByRole('link', { name: 'First' }));
    await user.click(screen.getByRole('dialog'));
    expect(onClose).not.toHaveBeenCalled();
    await user.click(screen.getByTestId('drawer-scrim'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
