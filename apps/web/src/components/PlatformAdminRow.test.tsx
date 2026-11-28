import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { platformAdminRows, type PlatformAdminRowView } from '@/mocks/platform/admins';
import { PlatformAdminRow, platformAdminColumns } from './PlatformAdminRow';

const base: PlatformAdminRowView = {
  id: 'a1',
  email: 'ada@example.com',
  name: 'Ada Lovelace',
  handle: 'ada',
  addedAt: { label: 'Nov 20, 2026', title: 'Nov 20, 2026, 09:00' },
  addedBy: 'grace@example.com',
  you: false,
  neverSignedIn: false,
  lastWorkingAdmin: false,
};

function renderRow(over: Partial<PlatformAdminRowView> = {}, busy?: boolean) {
  const onRevoke = vi.fn();
  const row = { ...base, ...over };
  render(
    <table>
      <tbody>
        <PlatformAdminRow row={row} busy={busy} onRevoke={onRevoke} />
      </tbody>
    </table>,
  );
  return { row, onRevoke };
}

describe('PlatformAdminRow', () => {
  it('has the columns Name, Email, Handle, Added, Added by, Actions', () => {
    expect(platformAdminColumns.map((c) => (typeof c.header === 'string' ? c.header : 'Actions'))).toEqual([
      'Name',
      'Email',
      'Handle',
      'Added',
      'Added by',
      'Actions',
    ]);
  });

  it('shows the cells and the added-at tooltip', () => {
    renderRow();
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
    expect(screen.getByText('ada@example.com')).toBeInTheDocument();
    expect(screen.getByText('ada')).toBeInTheDocument();
    expect(screen.getByText('Nov 20, 2026')).toHaveAttribute('title', 'Nov 20, 2026, 09:00');
    expect(screen.getByText('grace@example.com')).toBeInTheDocument();
    expect(screen.queryByText('You')).toBeNull();
  });

  it('tags the own row with You after the name', () => {
    renderRow({ you: true });
    const name = screen.getByText('Ada Lovelace');
    const you = screen.getByText('You');
    expect(name.compareDocumentPosition(you) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('shows Not signed in yet in place of the name, with a dash for handle and added by', () => {
    renderRow({ neverSignedIn: true, name: null, handle: null, addedBy: null });
    expect(screen.getByText('Not signed in yet')).toBeInTheDocument();
    expect(screen.getAllByText('—')).toHaveLength(2);
  });

  it('blanks handle and added by for a never-signed-in row even when the view holds values', () => {
    renderRow({ neverSignedIn: true, name: null, handle: 'ghost', addedBy: 'alice@example.com' });
    expect(screen.queryByText('alice@example.com')).not.toBeInTheDocument();
    expect(screen.queryByText('ghost')).not.toBeInTheDocument();
    expect(screen.getAllByText('—')).toHaveLength(2);
  });

  it('labels Revoke with the email and calls onRevoke', async () => {
    const { onRevoke, row } = renderRow();
    await userEvent.click(screen.getByRole('button', { name: 'Revoke platform access for ada@example.com' }));
    expect(onRevoke).toHaveBeenCalledWith(row);
  });

  it('disables Revoke on the last working admin with a visible reason', () => {
    renderRow({ lastWorkingAdmin: true });
    const button = screen.getByRole('button', { name: 'Revoke platform access for ada@example.com' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('title', 'Grant the role to someone else first.');
    const reason = screen.getByText('Last admin');
    expect(reason.id).not.toBe('');
    expect(button.getAttribute('aria-describedby')).toBe(reason.id);
  });

  it('disables Revoke while busy', () => {
    renderRow({}, true);
    expect(screen.getByRole('button', { name: /^Revoke platform access/ })).toBeDisabled();
  });

  it('renders markup in a name as text', () => {
    const { container } = render(
      <table>
        <tbody>
          <PlatformAdminRow row={{ ...base, name: '<img src=x onerror=alert(1)>' }} onRevoke={vi.fn()} />
        </tbody>
      </table>,
    );
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
  });

  it('has fixtures for you, another admin and a never-signed-in entry', () => {
    expect(platformAdminRows.some((r) => r.you)).toBe(true);
    expect(platformAdminRows.some((r) => !r.you && !r.neverSignedIn)).toBe(true);
    expect(platformAdminRows.some((r) => r.neverSignedIn)).toBe(true);
  });
});

describe('PlatformAdminRow phone card labels (BR-65)', () => {
  it('labels the data cells and leaves the actions cell unlabelled', () => {
    renderRow();
    expect(screen.getAllByRole('cell').map((c) => c.getAttribute('data-label'))).toEqual([
      'Name',
      'Email',
      'Handle',
      'Added',
      'Added by',
      null,
    ]);
  });
});
