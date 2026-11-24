import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AddPlatformAdminDialog, type AddPlatformAdminDialogProps } from './AddPlatformAdminDialog';

function setup(over: Partial<AddPlatformAdminDialogProps> = {}) {
  const handlers = { onChange: vi.fn(), onSubmit: vi.fn(), onClose: vi.fn() };
  render(<AddPlatformAdminDialog open values={{ email: '' }} errors={{}} saving={false} {...handlers} {...over} />);
  return handlers;
}

describe('AddPlatformAdminDialog', () => {
  it('renders nothing when closed', () => {
    setup({ open: false });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('has an Email field with the hint, Cancel and Add', () => {
    setup();
    expect(screen.getByRole('dialog', { name: 'Add platform admin' })).toBeInTheDocument();
    const input = screen.getByLabelText('Email');
    expect(screen.getByText('They need an Agent Desk account with a verified email.')).toBeInTheDocument();
    expect(input).toHaveAccessibleDescription('They need an Agent Desk account with a verified email.');
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Add' })).toBeEnabled();
  });

  it('reports typing, submit and cancel', async () => {
    const h = setup();
    await userEvent.type(screen.getByLabelText('Email'), 'a');
    expect(h.onChange).toHaveBeenCalledWith({ email: 'a' });
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(h.onSubmit).toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(h.onClose).toHaveBeenCalled();
  });

  it('shows Adding… and cannot be closed while saving', async () => {
    const h = setup({ saving: true });
    expect(screen.getByRole('button', { name: 'Adding…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    await userEvent.keyboard('{Escape}');
    expect(h.onClose).not.toHaveBeenCalled();
  });

  it('shows the field error under Email', () => {
    setup({ errors: { email: 'No account has this email yet.' } });
    expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Email')).toHaveAccessibleDescription(/No account has this email yet\./);
  });

  it('shows a banner with the problem title and request id', () => {
    setup({ formError: { title: 'Could not add the admin.', requestId: 'req-7' } });
    expect(screen.getByText('Could not add the admin.')).toBeInTheDocument();
    expect(screen.getByText('Request ID: req-7')).toBeInTheDocument();
  });

  it('omits the request id line when there is none', () => {
    setup({ formError: { title: 'Could not add the admin.' } });
    expect(screen.queryByText(/Request ID/)).toBeNull();
  });
});
