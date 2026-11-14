import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SecretField } from './SecretField';

const info = { setAt: '12 Oct 2026', setBy: 'kim-hale', status: { tone: 'err' as const, text: 'Rejected at 11:29' } };

describe('SecretField', () => {
  it('saved renders no input and never a value; Replace is collapsed', () => {
    const { container } = render(<SecretField state="saved" credentialType="oauth_token" savedInfo={info} />);
    expect(container.querySelector('input')).toBeNull();
    expect(screen.getByRole('button', { name: 'Replace' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByText(/Set 12 Oct 2026 by kim-hale/)).toBeInTheDocument();
    expect(screen.getByText('Rejected at 11:29')).toBeInTheDocument();
  });

  it('Replace calls onReplace', async () => {
    const onReplace = vi.fn();
    render(<SecretField state="saved" credentialType="api_key" savedInfo={info} onReplace={onReplace} />);
    await userEvent.click(screen.getByRole('button', { name: 'Replace' }));
    expect(onReplace).toHaveBeenCalled();
  });

  it('replacing shows expanded Replace and an empty password input', () => {
    render(<SecretField state="replacing" credentialType="oauth_token" savedInfo={info} />);
    expect(screen.getByRole('button', { name: 'Replace' })).toHaveAttribute('aria-expanded', 'true');
    const input = screen.getByLabelText('New token');
    expect(input).toHaveAttribute('type', 'password');
    expect(input).toHaveValue('');
  });

  it('replacing: submit passes the typed value; Cancel calls onCancel; blank submit disabled', async () => {
    const onSubmit = vi.fn();
    const onCancel = vi.fn();
    render(
      <SecretField
        state="replacing"
        credentialType="oauth_token"
        savedInfo={info}
        onSubmit={onSubmit}
        onCancel={onCancel}
      />,
    );
    const submit = screen.getByRole('button', { name: 'Test and replace' });
    expect(submit).toBeDisabled();
    await userEvent.type(screen.getByLabelText('New token'), 'sk-abc');
    await userEvent.click(submit);
    expect(onSubmit).toHaveBeenCalledWith('sk-abc');
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalled();
  });

  it('replacing starts empty again after leaving and re-entering replacing', async () => {
    const { rerender } = render(<SecretField state="replacing" credentialType="oauth_token" savedInfo={info} />);
    await userEvent.type(screen.getByLabelText('New token'), 'secret');
    rerender(<SecretField state="saved" credentialType="oauth_token" savedInfo={info} />);
    rerender(<SecretField state="replacing" credentialType="oauth_token" savedInfo={info} />);
    expect(screen.getByLabelText('New token')).toHaveValue('');
  });

  it('credential type change is reported', async () => {
    const onType = vi.fn();
    render(
      <SecretField state="replacing" credentialType="oauth_token" savedInfo={info} onCredentialTypeChange={onType} />,
    );
    await userEvent.click(screen.getByRole('radio', { name: 'API key' }));
    expect(onType).toHaveBeenCalledWith('api_key');
  });

  it('empty renders a labelled password input; entering submits', async () => {
    const onSubmit = vi.fn();
    render(<SecretField state="empty" credentialType="oauth_token" onSubmit={onSubmit} submitLabel="Save token" />);
    const input = screen.getByLabelText('Token');
    expect(input).toHaveAttribute('type', 'password');
    await userEvent.type(input, 'abc');
    await userEvent.click(screen.getByRole('button', { name: 'Save token' }));
    expect(onSubmit).toHaveBeenCalledWith('abc');
  });
});
