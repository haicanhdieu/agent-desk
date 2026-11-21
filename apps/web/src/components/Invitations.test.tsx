import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { invitationCards, orgInvitationRows } from '@/mocks';
import type { ExpiryView, OrgInvitationRowView } from '@/mocks/types';
import { ExpiryLabel } from './ExpiryLabel';
import { InvitationCard } from './InvitationCard';
import { InvitationRow } from './InvitationRow';
import { InviteLink } from './InviteLink';

const rowOf = (status: OrgInvitationRowView['status']) => {
  const r = orgInvitationRows.find((x) => x.status === status);
  if (!r) throw new Error(`no ${status} fixture`);
  return r;
};

function renderRow(row: OrgInvitationRowView, over: Partial<Parameters<typeof InvitationRow>[0]> = {}) {
  const handlers = { onCopy: vi.fn(), onResend: vi.fn(), onRevoke: vi.fn() };
  render(
    <table>
      <tbody>
        <InvitationRow row={row} {...handlers} {...over} />
      </tbody>
    </table>,
  );
  return handlers;
}

async function openMenu(row: OrgInvitationRowView) {
  await userEvent.click(screen.getByRole('button', { name: `Actions for ${row.email}` }));
  return screen.getByRole('dialog', { name: `Actions for ${row.email}` });
}

describe('InvitationRow menu (BR-19)', () => {
  it.each(['accepted', 'declined', 'revoked'] as const)(
    'a %s row has a disabled Actions button and no menu',
    async (status) => {
      const row = rowOf(status);
      renderRow(row);
      const button = screen.getByRole('button', { name: `Actions for ${row.email}` });
      expect(button).toBeDisabled();
      await userEvent.click(button);
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(screen.queryByRole('button', { name: 'Resend' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Revoke' })).toBeNull();
    },
  );

  it('an expired row offers Resend only', async () => {
    const row = rowOf('expired');
    renderRow(row);
    const menu = await openMenu(row);
    expect(within(menu).getByRole('button', { name: 'Resend' })).toBeInTheDocument();
    expect(within(menu).queryByRole('button', { name: 'Revoke' })).toBeNull();
    expect(within(menu).queryByRole('button', { name: 'Copy link' })).toBeNull();
  });

  it('menu items call their handlers', async () => {
    const row = rowOf('pending');
    const h = renderRow(row);
    await userEvent.click(within(await openMenu(row)).getByRole('button', { name: 'Copy link' }));
    expect(h.onCopy).toHaveBeenCalledTimes(1);
    await userEvent.click(within(await openMenu(row)).getByRole('button', { name: 'Resend' }));
    expect(h.onResend).toHaveBeenCalledTimes(1);
    await userEvent.click(within(await openMenu(row)).getByRole('button', { name: 'Revoke' }));
    expect(h.onRevoke).toHaveBeenCalledTimes(1);
  });

  it('busy disables the menu button', () => {
    const row = rowOf('pending');
    renderRow(row, { busy: true });
    expect(screen.getByRole('button', { name: `Actions for ${row.email}` })).toBeDisabled();
  });

  it.each([
    ['pending', 'Pending'],
    ['accepted', 'Accepted'],
    ['declined', 'Declined'],
    ['revoked', 'Revoked'],
    ['expired', 'Expired'],
  ] as const)('shows the %s status as a hidden glyph plus text', (status, label) => {
    renderRow(rowOf(status));
    const cell = screen.getByText(label).closest('td');
    expect(cell).not.toBeNull();
    expect(cell).toHaveTextContent(label);
    const svg = cell?.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg).toHaveAttribute('aria-hidden', 'true');
  });
});

describe('inviter deleted (BR-52)', () => {
  it('the row shows a plain dash under Invited by', () => {
    const row = { ...rowOf('pending'), invitedBy: null };
    renderRow(row);
    const cells = screen.getAllByRole('cell');
    expect(cells.map((c) => c.textContent)).toContain('–');
  });

  it('the row shows the inviter name as text', () => {
    renderRow(rowOf('pending'));
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
  });

  it('the card shows "Expires <date>" with no "Invited by"', () => {
    const card = { ...invitationCards[0]!, inviter: null };
    render(<InvitationCard card={card} pending={null} onAccept={vi.fn()} onDecline={vi.fn()} />);
    expect(screen.getByText(`Expires ${card.expires.text}`)).toBeInTheDocument();
    expect(screen.queryByText(/Invited by/)).toBeNull();
  });

  it('the card shows "Invited by <inviter>, expires <date>"', () => {
    const card = invitationCards[0]!;
    render(<InvitationCard card={card} pending={null} onAccept={vi.fn()} onDecline={vi.fn()} />);
    expect(screen.getByText(`Invited by ${card.inviter}, expires ${card.expires.text}`)).toBeInTheDocument();
  });
});

describe('ExpiryLabel (BR-51)', () => {
  it('a relative label has the exact date in title and an sr-only span', () => {
    const expires: ExpiryView = {
      kind: 'relative',
      text: 'Expires in 2 days',
      title: '23 Nov 2026, 14:05',
      dateTime: '2026-11-23T14:05:00Z',
    };
    const { container } = render(<ExpiryLabel expires={expires} />);
    const time = container.querySelector('time');
    expect(time).toHaveAttribute('title', '23 Nov 2026, 14:05');
    expect(time).toHaveAttribute('datetime', '2026-11-23T14:05:00Z');
    expect(time).toHaveTextContent('Expires in 2 days');
    expect(container.querySelector('.sr-only')).toHaveTextContent('23 Nov 2026, 14:05');
  });

  it('an exact label shows the date directly with the full date in title', () => {
    const expires: ExpiryView = {
      kind: 'exact',
      text: '10 Nov 2026, 14:05',
      title: '10 Nov 2026, 14:05',
      dateTime: '2026-11-10T14:05:00Z',
    };
    const { container } = render(<ExpiryLabel expires={expires} />);
    expect(screen.getByText('10 Nov 2026, 14:05')).toHaveAttribute('title', '10 Nov 2026, 14:05');
    expect(container.querySelector('.sr-only')).toBeNull();
  });

  it('none shows a muted dash', () => {
    render(<ExpiryLabel expires={{ kind: 'none', text: '–' }} />);
    expect(screen.getByText('–')).toBeInTheDocument();
  });
});

describe('InviteLink', () => {
  it('the labelled field shows the link and Copy link calls onCopy', async () => {
    const onCopy = vi.fn();
    render(<InviteLink link="https://x.example/invitations/1" onCopy={onCopy} />);
    expect(screen.getByRole('group', { name: 'Invitation link' })).toHaveTextContent('https://x.example/invitations/1');
    await userEvent.click(screen.getByRole('button', { name: 'Copy link' }));
    expect(onCopy).toHaveBeenCalledTimes(1);
  });

  it('copyFailed selects the field text', () => {
    render(<InviteLink link="https://x.example/invitations/1" onCopy={vi.fn()} copyFailed />);
    const field = screen.getByText('https://x.example/invitations/1');
    expect(window.getSelection()?.toString()).toBe('https://x.example/invitations/1');
    expect(field).toBeInTheDocument();
  });

  it('a second failed copy selects the text again while copyFailed stays true', async () => {
    render(<InviteLink link="https://x.example/invitations/1" onCopy={vi.fn()} copyFailed />);
    window.getSelection()?.removeAllRanges();
    expect(window.getSelection()?.toString()).toBe('');
    await userEvent.click(screen.getByRole('button', { name: 'Copy link' }));
    expect(window.getSelection()?.toString()).toBe('https://x.example/invitations/1');
  });
});

describe('InvitationCard', () => {
  const card = invitationCards[0]!;
  it('renders the org, role and access, with Accept and Decline calling their handlers', async () => {
    const onAccept = vi.fn();
    const onDecline = vi.fn();
    render(<InvitationCard card={card} pending={null} onAccept={onAccept} onDecline={onDecline} />);
    expect(screen.getByText('Acme invited you as Member')).toBeInTheDocument();
    expect(screen.getByText('Whole organization')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Accept' }));
    await userEvent.click(screen.getByRole('button', { name: 'Decline' }));
    expect(onAccept).toHaveBeenCalledTimes(1);
    expect(onDecline).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['accept', 'Accepting…', 'Decline'],
    ['decline', 'Declining…', 'Accept'],
  ] as const)('while %s is pending both buttons are disabled', (pending, pressed, other) => {
    render(<InvitationCard card={card} pending={pending} onAccept={vi.fn()} onDecline={vi.fn()} />);
    expect(screen.getByRole('button', { name: pressed })).toBeDisabled();
    expect(screen.getByRole('button', { name: other })).toBeDisabled();
  });
});
