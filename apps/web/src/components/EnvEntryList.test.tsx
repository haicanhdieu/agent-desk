import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { EnvEntryList, type EnvEntryListProps, type EnvSaveError } from './EnvEntryList';

const vars = [
  { name: 'ASPNETCORE_ENVIRONMENT', value: 'Development' },
  { name: 'DB_HOST', value: 'db.internal' },
  { name: 'EMPTY_ONE', value: '' },
];
const secrets = [
  { name: 'NPM_TOKEN', meta: 'Set 2 days ago by kim-hale' },
  { name: 'NUGET_KEY', meta: 'Set just now by kim-hale' },
];

type Save = Promise<EnvSaveError | null>;
const ok = (): Save => Promise.resolve(null);

function setup(over: Partial<EnvEntryListProps> = {}) {
  const props: EnvEntryListProps = {
    kind: 'variable',
    entries: vars,
    canWrite: true,
    onCreate: vi.fn(ok),
    onUpdate: vi.fn(ok),
    onRemove: vi.fn(ok),
    ...over,
  };
  const user = userEvent.setup();
  const view = render(<EnvEntryList {...props} />);
  return { props, user, ...view };
}

const btn = (name: string) => screen.getByRole('button', { name });
const addGroup = (name: string) => screen.getByRole('group', { name });

describe('EnvEntryList rows', () => {
  it('shows each variable with its name and value, and Empty for an empty value', () => {
    setup();
    const list = screen.getByRole('list', { name: 'Environment variables' });
    expect(within(list).getByText('DB_HOST')).toBeInTheDocument();
    expect(within(list).getByText('db.internal')).toBeInTheDocument();
    expect(within(list).getByText('Empty')).toBeInTheDocument();
  });

  it('shows secrets with the mask, hidden text and meta, and never a value', () => {
    setup({ kind: 'secret', entries: secrets });
    const list = screen.getByRole('list', { name: 'Secrets' });
    expect(within(list).getByText('NPM_TOKEN')).toBeInTheDocument();
    expect(within(list).getByText('Set 2 days ago by kim-hale')).toBeInTheDocument();
    expect(within(list).getAllByText('Value hidden')).toHaveLength(2);
    expect(list.querySelector('[aria-hidden="true"]')).not.toBeNull();
  });

  it('carries the entry name in the button names', () => {
    setup();
    expect(btn('Edit DB_HOST')).toBeInTheDocument();
    expect(btn('Remove DB_HOST')).toBeInTheDocument();
  });

  it('names the secret button Replace', () => {
    setup({ kind: 'secret', entries: secrets });
    expect(btn('Replace NPM_TOKEN')).toBeInTheDocument();
    expect(btn('Remove NPM_TOKEN')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Edit/ })).toBeNull();
  });

  it('shows the total in the header', () => {
    setup({ total: 12 });
    expect(screen.getByText('12 variables')).toBeInTheDocument();
  });

  it('hides Add, Edit, Replace and Remove without write permission', () => {
    const { unmount } = setup({ canWrite: false });
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText('db.internal')).toBeInTheDocument();
    unmount();
    setup({ kind: 'secret', entries: secrets, canWrite: false });
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText('NPM_TOKEN')).toBeInTheDocument();
  });
});

describe('EnvEntryList states', () => {
  it.each([
    ['variable', 'Loading variables'],
    ['secret', 'Loading secrets'],
  ] as const)('shows %s loading as a busy status', (kind, text) => {
    setup({ kind, entries: [], loading: true });
    expect(screen.getByText(text)).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
  });

  it.each([
    ['variable', 'No environment variables yet. Add one to pass a setting to every run.'],
    ['secret', 'No secrets yet. Add one for the tokens and passwords your setup or agent needs.'],
  ] as const)('shows the %s empty text', (kind, text) => {
    setup({ kind, entries: [] });
    expect(screen.getByText(text)).toBeInTheDocument();
  });

  it('shows a load error with the Request ID and Retry', async () => {
    const onRetry = vi.fn();
    const { user } = setup({
      entries: [],
      loadError: { message: 'Could not load the environment. Reload to try again.', requestId: 'req_123' },
      onRetry,
    });
    expect(screen.getByText('Could not load the environment. Reload to try again.')).toBeInTheDocument();
    expect(screen.getByText(/req_123/)).toBeInTheDocument();
    await user.click(btn('Retry'));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/No environment variables yet/)).toBeNull();
  });

  it('shows the pagination control only with rows and no loading or error', () => {
    const pagination = { page: 1, pageSize: 20 as const, total: 45, onPageChange: vi.fn(), onPageSizeChange: vi.fn() };
    const { unmount } = setup({ pagination });
    expect(screen.getByRole('navigation', { name: 'Pagination' })).toBeInTheDocument();
    unmount();
    const a = setup({ pagination, entries: [] });
    expect(screen.queryByRole('navigation')).toBeNull();
    a.unmount();
    const b = setup({ pagination, loading: true });
    expect(screen.queryByRole('navigation')).toBeNull();
    b.unmount();
    setup({ pagination, loadError: { message: 'x' } });
    expect(screen.queryByRole('navigation')).toBeNull();
  });
});

describe('EnvEntryList add', () => {
  it('submits name and value, closes the form and focuses the Add button', async () => {
    const { user, props } = setup();
    await user.click(btn('Add variable'));
    const form = addGroup('Add variable');
    await user.type(within(form).getByLabelText('Name'), 'AWS_REGION');
    await user.type(within(form).getByLabelText('Value'), 'eu-west-1');
    await user.click(within(form).getByRole('button', { name: 'Add variable' }));
    expect(props.onCreate).toHaveBeenCalledWith({ name: 'AWS_REGION', value: 'eu-west-1' });
    expect(screen.queryByRole('group', { name: 'Add variable' })).toBeNull();
    expect(btn('Add variable')).toHaveFocus();
  });

  it('shows the contract message on Name for an invalid name and keeps the typed input', async () => {
    const { user, props } = setup();
    await user.click(btn('Add variable'));
    const form = addGroup('Add variable');
    await user.type(within(form).getByLabelText('Name'), '9bad');
    await user.type(within(form).getByLabelText('Value'), 'keep-me');
    await user.click(within(form).getByRole('button', { name: 'Add variable' }));
    const name = within(form).getByLabelText('Name');
    expect(within(form).getByText('Use letters, digits and _, and do not start with a digit.')).toBeInTheDocument();
    expect(name).toHaveAttribute('aria-invalid', 'true');
    expect(name).toHaveValue('9bad');
    expect(within(form).getByLabelText('Value')).toHaveValue('keep-me');
    expect(props.onCreate).not.toHaveBeenCalled();
  });

  it('shows a server field error on Name', async () => {
    const onCreate = vi.fn((): Save =>
      Promise.resolve({
        field: { name: 'DB_HOST already exists. A name can be used once, as a variable or a secret.' },
      }),
    );
    const { user } = setup({ onCreate });
    await user.click(btn('Add variable'));
    const form = addGroup('Add variable');
    await user.type(within(form).getByLabelText('Name'), 'DB_HOST');
    await user.click(within(form).getByRole('button', { name: 'Add variable' }));
    expect(await within(form).findByText(/DB_HOST already exists/)).toBeInTheDocument();
    expect(within(form).getByLabelText('Name')).toHaveValue('DB_HOST');
  });

  it('shows a banner error with title, detail and Request ID, keeping the input', async () => {
    const onCreate = vi.fn((): Save =>
      Promise.resolve({
        banner: { title: 'Too many entries', detail: 'This project has 500 entries.', requestId: 'req_9' },
      }),
    );
    const { user } = setup({ onCreate });
    await user.click(btn('Add variable'));
    const form = addGroup('Add variable');
    await user.type(within(form).getByLabelText('Name'), 'NEW_ONE');
    await user.click(within(form).getByRole('button', { name: 'Add variable' }));
    expect(await within(form).findByText('Too many entries')).toBeInTheDocument();
    expect(within(form).getByText('This project has 500 entries.')).toBeInTheDocument();
    expect(within(form).getByText(/req_9/)).toBeInTheDocument();
    expect(within(form).getByLabelText('Name')).toHaveValue('NEW_ONE');
  });

  it('sends one request when the submit button is pressed twice', async () => {
    let release: (v: EnvSaveError | null) => void = () => undefined;
    const onCreate = vi.fn((): Save => new Promise((r) => (release = r)));
    const { user } = setup({ onCreate });
    await user.click(btn('Add variable'));
    const form = addGroup('Add variable');
    await user.type(within(form).getByLabelText('Name'), 'ONCE');
    const submit = within(form).getByRole('button', { name: 'Add variable' });
    await user.dblClick(submit);
    expect(onCreate).toHaveBeenCalledTimes(1);
    expect(within(form).getByRole('button', { name: 'Saving…' })).toBeDisabled();
    release(null);
  });

  it('closes the form on Cancel and returns focus to Add', async () => {
    const { user } = setup();
    await user.click(btn('Add variable'));
    await user.click(within(addGroup('Add variable')).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('group', { name: 'Add variable' })).toBeNull();
    expect(btn('Add variable')).toHaveFocus();
  });
});

describe('EnvEntryList Escape', () => {
  it('cancels the Add form on Escape, drops the typed text and returns focus to Add', async () => {
    const { user, props } = setup();
    await user.click(btn('Add variable'));
    await user.type(within(addGroup('Add variable')).getByLabelText('Name'), 'TYPED');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('group', { name: 'Add variable' })).toBeNull();
    expect(btn('Add variable')).toHaveFocus();
    expect(props.onCreate).not.toHaveBeenCalled();
  });

  it('cancels the Replace form on Escape and returns focus to the row Replace button', async () => {
    const { user, props } = setup({ kind: 'secret', entries: secrets });
    await user.click(btn('Replace NPM_TOKEN'));
    await user.type(screen.getByLabelText('New value'), 'half-typed');
    await user.keyboard('{Escape}');
    expect(screen.queryByLabelText('New value')).toBeNull();
    expect(btn('Replace NPM_TOKEN')).toHaveFocus();
    expect(props.onUpdate).not.toHaveBeenCalled();
  });

  it('ignores Escape while a save is pending, so the late success cannot close a later form', async () => {
    let resolve: (v: EnvSaveError | null) => void = () => {};
    const onCreate = vi.fn(() => new Promise<EnvSaveError | null>((r) => (resolve = r)));
    const { user } = setup({ onCreate });
    await user.click(btn('Add variable'));
    await user.type(within(addGroup('Add variable')).getByLabelText('Name'), 'FIRST');
    await user.keyboard('{Enter}');
    expect(onCreate).toHaveBeenCalledTimes(1);
    await user.keyboard('{Escape}');
    expect(addGroup('Add variable')).toBeInTheDocument();
    resolve(null);
    await waitFor(() => expect(screen.queryByRole('group', { name: 'Add variable' })).toBeNull());
    await user.click(btn('Add variable'));
    await user.type(within(addGroup('Add variable')).getByLabelText('Name'), 'SECOND');
    expect(within(addGroup('Add variable')).getByLabelText('Name')).toHaveValue('SECOND');
  });
});

describe('EnvEntryList secret entry', () => {
  it('uses a password input that starts empty, with help and a Show value toggle', async () => {
    const { user, props } = setup({ kind: 'secret', entries: secrets });
    await user.click(btn('Add secret'));
    const form = addGroup('Add secret');
    const value = within(form).getByLabelText('Value');
    expect(value).toHaveAttribute('type', 'password');
    expect(value).toHaveAttribute('autocomplete', 'new-password');
    expect(value).toHaveValue('');
    expect(within(form).getByText('At least 6 characters.')).toBeInTheDocument();
    await user.click(within(form).getByRole('button', { name: 'Show value' }));
    expect(value).toHaveAttribute('type', 'text');
    expect(within(form).getByRole('button', { name: 'Hide value' })).toBeInTheDocument();
    await user.type(within(form).getByLabelText('Name'), 'TOKEN_X');
    await user.type(value, 'abc');
    await user.click(within(form).getByRole('button', { name: 'Add secret' }));
    expect(within(form).getByText('Too short to hide in logs.')).toBeInTheDocument();
    expect(props.onCreate).not.toHaveBeenCalled();
  });

  it('opens Replace with an empty New value, Save disabled while blank, and returns focus to Replace', async () => {
    const { user, props } = setup({ kind: 'secret', entries: secrets });
    await user.click(btn('Replace NPM_TOKEN'));
    const input = screen.getByLabelText('New value');
    expect(input).toHaveValue('');
    expect(input).toHaveAttribute('type', 'password');
    expect(btn('Save')).toBeDisabled();
    await user.type(input, 'brand-new-secret');
    await user.click(btn('Save'));
    expect(props.onUpdate).toHaveBeenCalledWith('NPM_TOKEN', 'brand-new-secret');
    expect(screen.queryByLabelText('New value')).toBeNull();
    expect(btn('Replace NPM_TOKEN')).toHaveFocus();
  });
});

describe('EnvEntryList edit', () => {
  it('shows the name read-only, saves a new value and closes on Cancel', async () => {
    const { user, props } = setup();
    await user.click(btn('Edit DB_HOST'));
    expect(screen.getByText('DB_HOST')).toBeInTheDocument();
    expect(screen.queryByLabelText('Name')).toBeNull();
    const input = screen.getByLabelText('Value');
    expect(input).toHaveValue('db.internal');
    await user.clear(input);
    await user.type(input, 'db.new');
    await user.click(btn('Save'));
    expect(props.onUpdate).toHaveBeenCalledWith('DB_HOST', 'db.new');
    expect(btn('Edit DB_HOST')).toHaveFocus();
    await user.click(btn('Edit DB_HOST'));
    await user.click(btn('Cancel'));
    expect(screen.queryByLabelText('Value')).toBeNull();
    expect(btn('Edit DB_HOST')).toHaveFocus();
  });

  it('shows the gone message when the entry no longer exists', async () => {
    const onUpdate = vi.fn((): Save => Promise.resolve({ gone: true }));
    const { user } = setup({ onUpdate });
    await user.click(btn('Edit DB_HOST'));
    await user.click(btn('Save'));
    expect(await screen.findByText('This entry no longer exists. Reload the list.')).toBeInTheDocument();
  });
});

describe('EnvEntryList remove', () => {
  it('confirms in a dialog, removes, and focuses the Add button', async () => {
    const { user, props } = setup();
    await user.click(btn('Remove DB_HOST'));
    const dialog = screen.getByRole('dialog', { name: 'Remove DB_HOST?' });
    expect(within(dialog).getByText('Runs that start after this do not get it. Running runs keep it.')).toBeVisible();
    await user.click(within(dialog).getByRole('button', { name: 'Remove variable' }));
    expect(props.onRemove).toHaveBeenCalledWith('DB_HOST');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(btn('Add variable')).toHaveFocus();
  });

  it('keeps the entry on Keep and names the secret confirm button', async () => {
    const { user, props } = setup({ kind: 'secret', entries: secrets });
    await user.click(btn('Remove NPM_TOKEN'));
    const dialog = screen.getByRole('dialog', { name: 'Remove NPM_TOKEN?' });
    expect(within(dialog).getByRole('button', { name: 'Remove secret' })).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Keep' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(props.onRemove).not.toHaveBeenCalled();
  });
});

describe('EnvEntryList failures and initial states', () => {
  it('shows the remove failure in the dialog and keeps it open', async () => {
    const onRemove = vi.fn((): Save =>
      Promise.resolve({ banner: { title: 'Could not remove', detail: 'Try again later.', requestId: 'req_7' } }),
    );
    const { user } = setup({ onRemove });
    await user.click(btn('Remove DB_HOST'));
    const dialog = screen.getByRole('dialog', { name: 'Remove DB_HOST?' });
    await user.click(within(dialog).getByRole('button', { name: 'Remove variable' }));
    expect(await within(dialog).findByText('Could not remove')).toBeInTheDocument();
    expect(within(dialog).getByText('Try again later.')).toBeInTheDocument();
    expect(within(dialog).getByText(/req_7/)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Remove variable' })).toBeEnabled();
  });

  it('shows the gone text in the dialog when the entry no longer exists', async () => {
    const onRemove = vi.fn((): Save => Promise.resolve({ gone: true }));
    const { user } = setup({ onRemove });
    await user.click(btn('Remove DB_HOST'));
    const dialog = screen.getByRole('dialog', { name: 'Remove DB_HOST?' });
    await user.click(within(dialog).getByRole('button', { name: 'Remove variable' }));
    expect(await within(dialog).findByText('This entry no longer exists. Reload the list.')).toBeInTheDocument();
  });

  it('opens with a pending save when initial.saving is set', () => {
    setup({ initial: { editing: 'DB_HOST', saving: true } });
    const form = addGroup('Edit DB_HOST');
    expect(form).toHaveAttribute('aria-busy', 'true');
    expect(within(form).getByRole('button', { name: 'Saving…' })).toBeDisabled();
  });

  it('opens the remove dialog from initial.removing, pending when saving is also set', () => {
    const { unmount } = setup({ initial: { removing: 'DB_HOST' } });
    const open = screen.getByRole('dialog', { name: 'Remove DB_HOST?' });
    expect(within(open).getByRole('button', { name: 'Remove variable' })).toBeEnabled();
    unmount();
    setup({ initial: { removing: 'DB_HOST', saving: true } });
    const busy = screen.getByRole('dialog', { name: 'Remove DB_HOST?' });
    expect(within(busy).getByRole('button', { name: 'Remove variable' })).toBeDisabled();
    expect(within(busy).getByRole('button', { name: 'Keep' })).toBeDisabled();
  });

  it('shows the fallback message when onCreate throws', async () => {
    const { user } = setup({ onCreate: vi.fn(() => Promise.reject(new Error('boom'))) });
    await user.click(btn('Add variable'));
    const form = addGroup('Add variable');
    await user.type(within(form).getByLabelText('Name'), 'NEW_ONE');
    await user.click(within(form).getByRole('button', { name: 'Add variable' }));
    expect(await within(form).findByText('Something went wrong. Try again.')).toBeInTheDocument();
    expect(within(form).getByRole('button', { name: 'Add variable' })).toBeEnabled();
  });

  it('shows the fallback message when onUpdate throws', async () => {
    const { user } = setup({ onUpdate: vi.fn(() => Promise.reject(new Error('boom'))) });
    await user.click(btn('Edit DB_HOST'));
    const form = addGroup('Edit DB_HOST');
    await user.click(within(form).getByRole('button', { name: 'Save' }));
    expect(await within(form).findByText('Something went wrong. Try again.')).toBeInTheDocument();
    expect(within(form).getByRole('button', { name: 'Save' })).toBeEnabled();
  });

  it('shows the fallback message when onRemove throws', async () => {
    const { user } = setup({ onRemove: vi.fn(() => Promise.reject(new Error('boom'))) });
    await user.click(btn('Remove DB_HOST'));
    const dialog = screen.getByRole('dialog', { name: 'Remove DB_HOST?' });
    await user.click(within(dialog).getByRole('button', { name: 'Remove variable' }));
    expect(await within(dialog).findByText('Something went wrong. Try again.')).toBeInTheDocument();
  });
});
