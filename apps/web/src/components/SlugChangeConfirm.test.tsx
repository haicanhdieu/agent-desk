import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SlugChangeConfirm, type SlugChangeConfirmProps } from './SlugChangeConfirm';

function setup(over: Partial<SlugChangeConfirmProps> = {}) {
  const handlers = { onConfirm: vi.fn(), onCancel: vi.fn() };
  render(<SlugChangeConfirm from="alice" to="acme" closing="Tell the team." {...handlers} {...over} />);
  return handlers;
}

describe('SlugChangeConfirm', () => {
  it('names the old and new URL and the closing sentence', () => {
    setup();
    const dialog = screen.getByRole('dialog', { name: 'Change the organization URL?' });
    expect(dialog).toHaveTextContent('/o/alice becomes /o/acme.');
    expect(dialog).toHaveTextContent('Links that use /o/alice will show "not found". Tell the team.');
  });

  it('focuses Change URL and calls back from both buttons', async () => {
    const h = setup();
    expect(screen.getByRole('button', { name: 'Change URL' })).toHaveFocus();
    await userEvent.click(screen.getByRole('button', { name: 'Change URL' }));
    expect(h.onConfirm).toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(h.onCancel).toHaveBeenCalled();
  });

  it('busy: shows Changing… and disables both buttons', () => {
    setup({ busy: true });
    expect(screen.getByRole('button', { name: 'Changing…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  });
});
