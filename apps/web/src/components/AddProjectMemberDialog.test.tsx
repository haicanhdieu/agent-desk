import { useState } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { memberPickerOptions, projectRoleCards } from '@/mocks';
import { AddProjectMemberDialog, type AddProjectMemberDialogProps } from './AddProjectMemberDialog';

function baseProps(over: Partial<AddProjectMemberDialogProps> = {}): AddProjectMemberDialogProps {
  return {
    projectName: 'api',
    orgName: 'Acme',
    picker: {
      query: '',
      onQueryChange: vi.fn(),
      options: memberPickerOptions,
      total: memberPickerOptions.length,
      hasMore: false,
      state: { kind: 'idle' },
      picked: null,
      onPick: vi.fn(),
      onLoadMore: vi.fn(),
    },
    roles: projectRoleCards,
    roleId: null,
    errors: {},
    saving: false,
    onRoleChange: vi.fn(),
    onSubmit: vi.fn(),
    onCancel: vi.fn(),
    ...over,
  };
}

function setup(over: Partial<AddProjectMemberDialogProps> = {}) {
  const props = baseProps(over);
  render(<AddProjectMemberDialog {...props} />);
  return props as Required<Pick<AddProjectMemberDialogProps, 'onRoleChange' | 'onSubmit' | 'onCancel'>>;
}

describe('AddProjectMemberDialog', () => {
  it('shows the title, focuses Person and shows the help text', () => {
    setup();
    expect(screen.getByRole('dialog', { name: 'Add member to api' })).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('combobox'));
    expect(screen.getByText('Only members of Acme are listed. To add someone new, use Invite people.')).toBeTruthy();
  });

  it('offers a Role radio group with exactly the given cards, none checked', () => {
    setup();
    const group = screen.getByRole('radiogroup', { name: 'Role' });
    const radios = within(group).getAllByRole('radio') as HTMLInputElement[];
    expect(radios).toHaveLength(projectRoleCards.length);
    expect(radios.some((r) => r.checked)).toBe(false);
  });

  it('reports a role change', async () => {
    const h = setup();
    await userEvent.click(screen.getByRole('radio', { name: /Viewer/ }));
    expect(h.onRoleChange).toHaveBeenCalledWith(projectRoleCards[2]?.roleId);
  });

  it('marks fields invalid and describes them with their errors', () => {
    setup({ errors: { userId: 'Choose a person.', roleId: 'Choose a role.' } });
    const person = screen.getByRole('combobox');
    expect(person.getAttribute('aria-invalid')).toBe('true');
    const describedBy = person.getAttribute('aria-describedby') ?? '';
    const ids = describedBy.split(' ');
    expect(ids.some((i) => document.getElementById(i)?.textContent === 'Choose a person.')).toBe(true);
    const group = screen.getByRole('radiogroup', { name: 'Role' });
    expect(group.getAttribute('aria-invalid')).toBe('true');
    expect(
      (group.getAttribute('aria-describedby') ?? '')
        .split(' ')
        .some((i) => document.getElementById(i)?.textContent === 'Choose a role.'),
    ).toBe(true);
  });

  it('shows the form error as an alert with the request id', () => {
    setup({ formError: { title: 'Could not add member', detail: 'Try again.', requestId: 'req-9' } });
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('Could not add member');
    expect(alert.textContent).toContain('Try again.');
    expect(alert.textContent).toContain('Request ID: req-9');
  });

  it('saving shows Adding…, disables the button and ignores Escape', async () => {
    const h = setup({ saving: true });
    const btn = screen.getByRole('button', { name: 'Adding…' }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    await userEvent.keyboard('{Escape}');
    expect(h.onCancel).not.toHaveBeenCalled();
  });

  it('submits once on a double click while the parent flips saving', async () => {
    const onSubmit = vi.fn();
    function Parent() {
      const [saving, setSaving] = useState(false);
      return (
        <AddProjectMemberDialog
          {...baseProps()}
          saving={saving}
          onSubmit={() => {
            onSubmit();
            setSaving(true);
          }}
        />
      );
    }
    render(<Parent />);
    await userEvent.dblClick(screen.getByRole('button', { name: 'Add member' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('submits again after a failed submit that leaves the same errors and saving false', async () => {
    const h = setup({ errors: { userId: 'Choose a person.' } });
    const btn = screen.getByRole('button', { name: 'Add member' });
    await userEvent.click(btn);
    await userEvent.click(btn);
    expect(h.onSubmit).toHaveBeenCalledTimes(2);
  });

  it('Cancel calls onCancel', async () => {
    const h = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(h.onCancel).toHaveBeenCalled();
  });
});
