import { createEvent, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { TerminalKeys, type TerminalKey } from './TerminalKeys';

const ORDER: Array<[string, TerminalKey]> = [
  ['Esc', 'esc'],
  ['Tab', 'tab'],
  ['Left arrow', 'left'],
  ['Up arrow', 'up'],
  ['Down arrow', 'down'],
  ['Right arrow', 'right'],
  ['Ctrl-C', 'ctrl-c'],
  ['Enter', 'enter'],
];

describe('TerminalKeys', () => {
  it('is a Terminal keys group with the buttons in order', () => {
    render(<TerminalKeys onKey={vi.fn()} />);
    const group = screen.getByRole('group', { name: 'Terminal keys' });
    const names = Array.from(group.querySelectorAll('button')).map(
      (b) => b.getAttribute('aria-label') ?? b.textContent,
    );
    expect(names).toEqual(ORDER.map(([n]) => n));
  });

  it.each(ORDER)('click on %s calls onKey once with its key', async (name, key) => {
    const onKey = vi.fn();
    render(<TerminalKeys onKey={onKey} />);
    await userEvent.click(screen.getByRole('button', { name }));
    expect(onKey).toHaveBeenCalledTimes(1);
    expect(onKey).toHaveBeenCalledWith(key);
  });

  it('keyboard activation calls onKey once', async () => {
    const onKey = vi.fn();
    render(<TerminalKeys onKey={onKey} />);
    screen.getByRole('button', { name: 'Tab' }).focus();
    await userEvent.keyboard('{Enter}');
    expect(onKey).toHaveBeenCalledTimes(1);
    expect(onKey).toHaveBeenCalledWith('tab');
    await userEvent.keyboard(' ');
    expect(onKey).toHaveBeenCalledTimes(2);
  });

  it.each(['pointerDown', 'mouseDown'] as const)('%s is default-prevented so focus does not move', (type) => {
    render(<TerminalKeys onKey={vi.fn()} />);
    const btn = screen.getByRole('button', { name: 'Esc' });
    const ev = createEvent[type](btn);
    fireEvent(btn, ev);
    expect(ev.defaultPrevented).toBe(true);
  });
});
