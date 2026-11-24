import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { EditOrgDialog, type EditOrgDialogProps } from './EditOrgDialog';

function setup(over: Partial<EditOrgDialogProps> = {}) {
  const handlers = { onChange: vi.fn(), onSubmit: vi.fn(), onClose: vi.fn() };
  render(
    <EditOrgDialog
      open
      values={{ name: 'Acme', slug: 'acme' }}
      errors={{}}
      dirty={false}
      saving={false}
      {...handlers}
      {...over}
    />,
  );
  return handlers;
}

describe('EditOrgDialog', () => {
  it('renders nothing when closed', () => {
    setup({ open: false });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('shows the title, Name and URL fields and the URL help', () => {
    setup();
    expect(screen.getByRole('dialog', { name: 'Edit organization' })).toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toHaveValue('Acme');
    expect(screen.getByLabelText('URL')).toHaveValue('acme');
    expect(screen.getByText('Links that use the old URL will show "not found".')).toBeInTheDocument();
  });

  it('links the /o/ prefix to the URL input by aria-describedby', () => {
    setup();
    const ids = (screen.getByLabelText('URL').getAttribute('aria-describedby') ?? '').split(' ');
    const prefix = screen.getByText('/o/');
    expect(ids).toContain(prefix.id);
  });

  it('focuses Name when opened', () => {
    setup();
    expect(screen.getByLabelText('Name')).toHaveFocus();
  });

  it('reports typing in each field with both values', async () => {
    const h = setup();
    await userEvent.type(screen.getByLabelText('Name'), 'X');
    expect(h.onChange).toHaveBeenLastCalledWith({ name: 'AcmeX', slug: 'acme' });
    await userEvent.type(screen.getByLabelText('URL'), 'y');
    expect(h.onChange).toHaveBeenLastCalledWith({ name: 'Acme', slug: 'acmey' });
  });

  it('keeps Save disabled until dirty', async () => {
    const h = setup();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(h.onSubmit).not.toHaveBeenCalled();
  });

  it('submits from Save and Enter when dirty', async () => {
    const h = setup({ dirty: true });
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(h.onSubmit).toHaveBeenCalledTimes(1);
    await userEvent.type(screen.getByLabelText('Name'), '{Enter}');
    expect(h.onSubmit).toHaveBeenCalledTimes(2);
  });

  it('Cancel closes', async () => {
    const h = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(h.onClose).toHaveBeenCalled();
  });

  it('saving: shows Saving…, disabled, and cannot be closed', async () => {
    const h = setup({ dirty: true, saving: true });
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    await userEvent.keyboard('{Escape}');
    expect(h.onClose).not.toHaveBeenCalled();
  });

  it('shows field errors on the fields', () => {
    setup({ dirty: true, errors: { name: 'Enter a name.', slug: 'This URL is taken. Try another.' } });
    expect(screen.getByLabelText('Name')).toHaveAccessibleDescription('Enter a name.');
    expect(screen.getByLabelText('Name')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('URL')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('This URL is taken. Try another.')).toBeInTheDocument();
  });

  it('shows the form error banner with the request id', () => {
    setup({ formError: { title: 'Could not save.', requestId: '01JDK8Q3V2' } });
    expect(screen.getByText('Could not save.')).toBeInTheDocument();
    expect(screen.getByText('Request ID: 01JDK8Q3V2')).toBeInTheDocument();
  });
});
