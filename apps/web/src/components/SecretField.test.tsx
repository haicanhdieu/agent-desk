import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SecretField } from './SecretField';

const info = { setAt: '12 Oct 2026', setBy: 'kim-hale', status: { tone: 'err' as const, text: 'Rejected at 11:29' } };

describe('SecretField nested', () => {
  it('renders no form of its own and Enter in a flow with its own submit button submits the value once', async () => {
    const onSubmit = vi.fn();
    const { container } = render(
      <form>
        <SecretField state="entering" credentialType="api_key" nested onSubmit={onSubmit} />
      </form>,
    );
    expect(container.querySelector('form form')).toBeNull();
    await userEvent.type(screen.getByLabelText('Token'), 'abc{Enter}');
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith('abc');
  });

  it('with hideSubmit, Enter is left to the surrounding form', async () => {
    const onSubmit = vi.fn();
    const outer = vi.fn((e: React.FormEvent) => e.preventDefault());
    render(
      <form onSubmit={outer}>
        <SecretField state="entering" credentialType="api_key" nested hideSubmit onSubmit={onSubmit} />
        <button type="submit">Go</button>
      </form>,
    );
    await userEvent.type(screen.getByLabelText('Token'), 'abc{Enter}');
    expect(outer).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

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

  it('replacing overrides title, status, note and help', () => {
    render(
      <SecretField
        state="replacing"
        credentialType="oauth_token"
        savedInfo={info}
        replacing={{
          title: 'Credential needed again',
          status: 'Replaced when you save',
          note: 'A note.',
          help: 'A help.',
        }}
      />,
    );
    expect(screen.getByText('Credential needed again')).toBeInTheDocument();
    expect(screen.queryByText('Replace credential')).toBeNull();
    expect(screen.getByText('Replaced when you save')).toBeInTheDocument();
    expect(screen.queryByText('Rejected at 11:29')).toBeNull();
    expect(screen.getByText('A note.')).toBeInTheDocument();
    expect(screen.getByText('A help.')).toBeInTheDocument();
    expect(screen.getByLabelText('New token')).toHaveAccessibleDescription('A help.');
  });

  describe('provider-supplied texts', () => {
    const types = [
      { type: 'auth_json' as const, label: 'Credentials file' },
      { type: 'api_key' as const, label: 'API endpoint and key' },
    ];

    it('saved names the credential type from the given names', () => {
      render(<SecretField state="saved" credentialType="auth_json" credentialTypes={types} savedInfo={info} />);
      expect(screen.getByText('Credentials file')).toBeInTheDocument();
      expect(screen.queryByText('Auth file')).toBeNull();
    });

    it('entering uses the value label for the input and its reveal button, and the help', () => {
      render(
        <SecretField
          state="entering"
          credentialType="auth_json"
          valueLabel="Credentials file"
          entryHelp="Paste the file."
          submitLabel="Save and test"
        />,
      );
      expect(screen.getByLabelText('Credentials file')).toHaveAccessibleDescription('Paste the file.');
      expect(screen.getByRole('button', { name: 'Show credentials file' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Save and test' })).toBeDisabled();
    });

    it('replacing offers the given types under the given label and reports a switch', async () => {
      const onType = vi.fn();
      render(
        <SecretField
          state="replacing"
          credentialType="auth_json"
          credentialTypes={types}
          typeLabel="Authentication"
          valueLabel="Credentials file"
          onCredentialTypeChange={onType}
          savedInfo={info}
        />,
      );
      const group = screen.getByRole('radiogroup', { name: 'Authentication' });
      expect(Array.from(group.querySelectorAll('[role=radio]')).map((r) => r.textContent)).toEqual([
        'Credentials file',
        'API endpoint and key',
      ]);
      await userEvent.click(screen.getByRole('radio', { name: 'API endpoint and key' }));
      expect(onType).toHaveBeenCalledWith('api_key');
    });

    it('replacing with one type shows no type control; replaceHelp is the default help', () => {
      render(
        <SecretField
          state="replacing"
          credentialType="oauth_token"
          credentialTypes={[{ type: 'oauth_token', label: 'Subscription token' }]}
          replaceHelp="We save it, then test it."
          savedInfo={info}
        />,
      );
      expect(screen.queryByRole('radiogroup')).toBeNull();
      expect(screen.getByLabelText('New token')).toHaveAccessibleDescription('We save it, then test it.');
    });

    it('submitDisabled keeps the submit button disabled even with a value', async () => {
      render(<SecretField state="replacing" credentialType="api_key" submitDisabled savedInfo={info} />);
      await userEvent.type(screen.getByLabelText('New token'), 'sk-1');
      expect(screen.getByRole('button', { name: 'Test and replace' })).toBeDisabled();
    });

    it('onValueChange also reports typing in the replace panel', async () => {
      const onValueChange = vi.fn();
      render(<SecretField state="replacing" credentialType="api_key" onValueChange={onValueChange} savedInfo={info} />);
      await userEvent.type(screen.getByLabelText('New token'), 'ab');
      expect(onValueChange).toHaveBeenLastCalledWith('ab');
    });
  });
});
