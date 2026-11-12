import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Popover } from './Popover';

function Harness({ onClose }: { onClose: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ position: 'relative' }}>
      <button onClick={() => setOpen(true)}>Cancel run</button>
      <Popover open={open} label="Confirm cancel" onClose={() => { onClose(); setOpen(false); }}>
        <button>Keep running</button><button>Cancel it</button>
      </Popover>
    </div>
  );
}

describe('Popover', () => {
  it('renders nothing when closed', () => {
    render(<Popover open={false} label="L">x</Popover>);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('dialog role: named by label, focus in on keyboard open, Escape closes, focus returns', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    const opener = screen.getByRole('button', { name: 'Cancel run' });
    opener.focus();
    await user.keyboard('{Enter}');
    const pop = screen.getByRole('dialog', { name: 'Confirm cancel' });
    expect(pop).not.toHaveAttribute('aria-modal', 'true');
    expect(screen.getByRole('button', { name: 'Keep running' })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(opener).toHaveFocus();
  });

  it('status role does not move focus', () => {
    render(<><button>Before</button><Popover open label="Reconnecting" role="status"><button>Retry</button></Popover></>);
    const pop = screen.getByRole('status', { name: 'Reconnecting' });
    expect(pop.contains(document.activeElement)).toBe(false);
  });

  it('dialog role: Escape closes even when focus is back on the opener', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    const opener = screen.getByRole('button', { name: 'Cancel run' });
    await user.click(opener);
    opener.focus();
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('status role ignores Escape', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Popover open label="Reconnecting" role="status" onClose={onClose}>x</Popover>);
    await user.keyboard('{Escape}');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('removes the listener after unmount', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const { unmount } = render(<Popover open label="L" onClose={onClose}><button>a</button></Popover>);
    unmount();
    await user.keyboard('{Escape}');
    expect(onClose).not.toHaveBeenCalled();
  });
});
