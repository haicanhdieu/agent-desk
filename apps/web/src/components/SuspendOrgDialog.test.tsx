import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SuspendOrgDialog, type SuspendOrgDialogProps } from './SuspendOrgDialog';

function setup(over: Partial<SuspendOrgDialogProps> = {}) {
  const handlers = { onReason: vi.fn(), onSubmit: vi.fn(), onClose: vi.fn() };
  render(<SuspendOrgDialog mode="suspend" orgName="Acme" open reason="" saving={false} {...handlers} {...over} />);
  return handlers;
}

describe('SuspendOrgDialog', () => {
  it('renders nothing when closed', () => {
    setup({ open: false });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('suspend: title, body, Reason textarea and a Suspend button', async () => {
    const h = setup();
    expect(screen.getByRole('dialog', { name: 'Suspend Acme?' })).toBeInTheDocument();
    expect(
      screen.getByText(
        'People in this organization cannot open it and no new runs start. Runs already in progress finish. Nothing is deleted.',
      ),
    ).toBeInTheDocument();
    const reason = screen.getByLabelText('Reason');
    expect(reason.tagName).toBe('TEXTAREA');
    expect(reason).toHaveAttribute('rows', '3');
    await userEvent.type(reason, 'a');
    expect(h.onReason).toHaveBeenCalledWith('a');
    expect(screen.getByRole('button', { name: 'Suspend' })).toHaveClass('solid-danger');
    await userEvent.click(screen.getByRole('button', { name: 'Suspend' }));
    expect(h.onSubmit).toHaveBeenCalled();
  });

  it('reactivate: title, body and a Reactivate button', async () => {
    const h = setup({ mode: 'reactivate' });
    expect(screen.getByRole('dialog', { name: 'Reactivate Acme?' })).toBeInTheDocument();
    expect(screen.getByText('People can open it again.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reactivate' })).toHaveClass('primary');
    await userEvent.click(screen.getByRole('button', { name: 'Reactivate' }));
    expect(h.onSubmit).toHaveBeenCalled();
  });

  it('shows Suspending… / Reactivating… and cannot be closed while saving', async () => {
    const h = setup({ saving: true });
    expect(screen.getByRole('button', { name: 'Suspending…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    await userEvent.keyboard('{Escape}');
    expect(h.onClose).not.toHaveBeenCalled();
  });

  it('reactivate saving label', () => {
    setup({ mode: 'reactivate', saving: true });
    expect(screen.getByRole('button', { name: 'Reactivating…' })).toBeDisabled();
  });

  it('Escape closes when idle', async () => {
    const h = setup();
    await userEvent.keyboard('{Escape}');
    expect(h.onClose).toHaveBeenCalled();
  });

  it('shows the field error at Reason', () => {
    setup({ error: 'Give a reason.' });
    expect(screen.getByLabelText('Reason')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Reason')).toHaveAccessibleDescription(/Give a reason\./);
  });

  it('shows a form error banner with the request id', () => {
    setup({ formError: { title: 'Could not suspend.', requestId: '01JDK' } });
    expect(screen.getByText('Could not suspend.')).toBeInTheDocument();
    expect(screen.getByText('Request ID: 01JDK')).toBeInTheDocument();
  });
});
