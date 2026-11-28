import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { composeStories } from '@storybook/react-vite';
import { OrgGeneral, type OrgGeneralProps } from './OrgGeneral';
import * as orgSettingsStories from './orgSettings.stories';
import { expectShellOwnedPage } from '@/test/shellAssert';
import { OrgShellFrame } from './orgShellFrame';

const props = (over: Partial<OrgGeneralProps> = {}): OrgGeneralProps => ({
  state: { kind: 'ready' },
  name: { value: 'Harbor Labs', onChange: vi.fn() },
  slug: { value: 'harbor-labs', onChange: vi.fn() },
  dirty: false,
  saving: false,
  onSave: vi.fn(),
  ...over,
});

describe('OrgGeneral', () => {
  it('BR-15: shows h1 General, the Organization section and the Name and URL fields with the /o/ prefix and help', () => {
    render(<OrgGeneral {...props()} />);
    expect(screen.getByRole('heading', { level: 1, name: 'General' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Organization' })).toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toHaveValue('Harbor Labs');
    const url = screen.getByLabelText('URL');
    expect(url).toHaveValue('harbor-labs');
    expect(screen.getByText('/o/')).toBeInTheDocument();
    expect(url).toHaveAccessibleDescription('/o/ Links that use the old URL will show "not found".');
  });

  it('Save is disabled while nothing changed and enabled when dirty', async () => {
    const onSave = vi.fn();
    const { rerender } = render(<OrgGeneral {...props({ onSave })} />);
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    rerender(<OrgGeneral {...props({ onSave, dirty: true })} />);
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('saving shows Saving… busy and disabled', () => {
    render(<OrgGeneral {...props({ dirty: true, saving: true })} />);
    const button = screen.getByRole('button', { name: 'Saving…' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
  });

  it('typing calls onChange of the right field', async () => {
    const name = { value: 'Harbor Labs', onChange: vi.fn() };
    const slug = { value: 'harbor-labs', onChange: vi.fn() };
    render(<OrgGeneral {...props({ name, slug })} />);
    await userEvent.type(screen.getByLabelText('Name'), 'X');
    await userEvent.type(screen.getByLabelText('URL'), 'y');
    expect(name.onChange).toHaveBeenCalledWith('Harbor LabsX');
    expect(slug.onChange).toHaveBeenCalledWith('harbor-labsy');
  });

  it('BR-15 (screen part of TC-15.1): the name error shows under Name, the input is kept and focused', () => {
    render(<OrgGeneral {...props({ name: { value: '', error: 'Enter a name.', onChange: vi.fn() }, dirty: true })} />);
    const name = screen.getByLabelText('Name');
    expect(name).toHaveValue('');
    expect(name).toHaveAttribute('aria-invalid', 'true');
    expect(name).toHaveAccessibleDescription('Enter a name.');
    expect(name).toHaveFocus();
  });

  it('BR-15 (screen part of TC-15.2): the too-long name error keeps the 101 characters', () => {
    const value = 'a'.repeat(101);
    render(
      <OrgGeneral
        {...props({ name: { value, error: 'Use 100 characters or fewer.', onChange: vi.fn() }, dirty: true })}
      />,
    );
    expect(screen.getByLabelText('Name')).toHaveValue(value);
    expect(screen.getByText('Use 100 characters or fewer.')).toBeInTheDocument();
  });

  it('BR-15: the NameTooLong story shows a name over 100 characters next to the length error', () => {
    const { OrgGeneralNameTooLong } = composeStories(orgSettingsStories);
    render(<OrgGeneralNameTooLong />);
    const value = (screen.getByLabelText('Name') as HTMLInputElement).value;
    expect(value.length).toBeGreaterThan(100);
    expect(screen.getByText('Use 100 characters or fewer.')).toBeInTheDocument();
  });

  it('BR-17 (screen part of TC-17.6): the slug error shows under URL, the input is kept and focused when Name is fine', () => {
    render(
      <OrgGeneral
        {...props({
          slug: { value: 'taken', error: 'This URL is taken. Try another.', onChange: vi.fn() },
          dirty: true,
        })}
      />,
    );
    const url = screen.getByLabelText('URL');
    expect(url).toHaveValue('taken');
    expect(url).toHaveAttribute('aria-invalid', 'true');
    expect(url).toHaveAccessibleDescription(/This URL is taken\. Try another\./);
    expect(url).toHaveFocus();
    expect(screen.getByLabelText('Name')).not.toHaveAttribute('aria-invalid');
  });

  it('BR-17: both errors focus the first invalid field, Name', () => {
    render(
      <OrgGeneral
        {...props({
          name: { value: '', error: 'Enter a name.', onChange: vi.fn() },
          slug: {
            value: '-x-',
            error: 'Use lowercase letters, numbers and dashes, with no dash at the start or end.',
            onChange: vi.fn(),
          },
          dirty: true,
        })}
      />,
    );
    expect(screen.getByLabelText('Name')).toHaveFocus();
    expect(
      screen.getByText('Use lowercase letters, numbers and dashes, with no dash at the start or end.'),
    ).toBeInTheDocument();
  });

  it('the form Banner shows the title and request id and keeps the input', () => {
    render(
      <OrgGeneral
        {...props({
          name: { value: 'Harbor Labs Group', onChange: vi.fn() },
          dirty: true,
          formError: { title: 'Internal server error', requestId: 'req_01JD7Q3M8V2K' },
        })}
      />,
    );
    const alert = screen.getByRole('alert');
    expect(within(alert).getByText('Internal server error')).toBeInTheDocument();
    expect(within(alert).getByText('Request ID: req_01JD7Q3M8V2K')).toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toHaveValue('Harbor Labs Group');
  });

  it('BR-16 / TC-16.1: the slug confirm names both URLs, focuses Change URL, and its buttons call back', async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <OrgGeneral
        {...props({
          slug: { value: 'acme', onChange: vi.fn() },
          dirty: true,
          slugConfirm: { from: 'alice', to: 'acme', onConfirm, onCancel },
        })}
      />,
    );
    const dialog = screen.getByRole('dialog', { name: 'Change the organization URL?' });
    expect(dialog).toHaveTextContent(
      '/o/alice becomes /o/acme. Links that use /o/alice will show "not found". Share the new link with your members.',
    );
    const change = within(dialog).getByRole('button', { name: 'Change URL' });
    expect(change).toHaveFocus();
    await userEvent.click(change);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('TC-16.2: Escape in the slug confirm cancels, and focus returns to the opener', async () => {
    const onCancel = vi.fn();
    const slugConfirm = { from: 'alice', to: 'acme', onConfirm: vi.fn(), onCancel };
    const { rerender } = render(<OrgGeneral {...props({ dirty: true })} />);
    const save = screen.getByRole('button', { name: 'Save' });
    save.focus();
    rerender(<OrgGeneral {...props({ dirty: true, slugConfirm })} />);
    await userEvent.keyboard('{Escape}');
    expect(onCancel).toHaveBeenCalledTimes(1);
    rerender(<OrgGeneral {...props({ dirty: true })} />);
    expect(save).toHaveFocus();
  });

  it('the saved notice is a status toast and Dismiss calls back', async () => {
    const onDismiss = vi.fn();
    render(<OrgGeneral {...props({ notice: { tone: 'ok', title: 'Organization updated', onDismiss } })} />);
    expect(within(screen.getByRole('status')).getByText('Organization updated')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /dismiss|close/i }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('BR-2: forbidden shows the no-access copy and no form', () => {
    render(<OrgGeneral {...props({ state: { kind: 'forbidden' } })} />);
    expect(screen.getByRole('heading', { level: 1, name: "You don't have access" })).toBeInTheDocument();
    expect(screen.getByText('Ask an owner of this organization to give you access.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Name')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
  });

  it('an org name with markup renders as text, not HTML', () => {
    const value = '<img src=x onerror=alert(1)>';
    render(
      <OrgGeneral
        {...props({
          name: { value, onChange: vi.fn() },
          slug: { value: 'a', onChange: vi.fn() },
          slugConfirm: { from: '<b>old</b>', to: 'new', onConfirm: vi.fn(), onCancel: vi.fn() },
        })}
      />,
    );
    expect(screen.getByLabelText('Name')).toHaveValue(value);
    expect(document.querySelector('img')).toBeNull();
    expect(document.querySelector('b')).toBeNull();
    expect(screen.getByRole('dialog')).toHaveTextContent('/o/<b>old</b> becomes /o/new.');
  });
});

describe('OrgGeneral in the shell', () => {
  const inShell = (p: OrgGeneralProps) =>
    render(
      <OrgShellFrame viewer="owner" page="general">
        <OrgGeneral {...p} />
      </OrgShellFrame>,
    );

  it('ready draws one main with the h1 General, the Organization section and Save, no chrome of its own', () => {
    inShell(props({ dirty: true }));
    const main = expectShellOwnedPage('General');
    expect(within(main).getByRole('region', { name: 'Organization' })).toBeInTheDocument();
    expect(within(main).getByRole('button', { name: 'Save' })).toBeEnabled();
  });

  it('a form error banner sits under the h1 in the page header', () => {
    inShell(props({ formError: { title: 'Could not save', requestId: 'req_1' } }));
    const main = expectShellOwnedPage('General');
    const banner = within(main).getByText('Could not save');
    expect(
      screen.getByRole('heading', { level: 1 }).compareDocumentPosition(banner) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('forbidden keeps one main with the no-access h1', () => {
    inShell(props({ state: { kind: 'forbidden' } }));
    expectShellOwnedPage("You don't have access", { pageHeader: false });
  });
});
