import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { MemberRowView } from '@/mocks/types';
import { DataTable } from './DataTable';
import { MemberRow, memberColumns } from './MemberRow';

const columns = [
  { key: 'repo', header: 'Repository' },
  { key: 'runs', header: 'Active runs', align: 'right' as const },
];

const member: MemberRowView = {
  userId: 'u1',
  name: 'Cleo Martin',
  handle: 'cleo',
  you: false,
  role: { key: 'member', name: 'Member' },
  grants: [{ id: 'g0', scopeName: 'Organization', roleName: 'Member' }],
  canChangeRole: true,
  canRemove: true,
};

describe('DataTable', () => {
  it('keeps the header row in the accessibility tree: the card layout hides it by CSS only', () => {
    render(
      <DataTable columns={columns}>
        <tr>
          <td data-label="Repository">acme/billing</td>
          <td data-label="Active runs">2</td>
        </tr>
      </DataTable>,
    );
    const heads = screen.getAllByRole('columnheader');
    expect(heads.map((h) => h.textContent)).toEqual(['Repository', 'Active runs']);
    expect(heads[0]?.closest('thead')).not.toHaveAttribute('hidden');
    expect(heads[0]?.closest('thead')).not.toHaveAttribute('aria-hidden');
  });

  it('is a card table below 640px by default, and not when cards is false', () => {
    const { rerender } = render(
      <DataTable columns={columns}>
        <tr>
          <td>a</td>
          <td>b</td>
        </tr>
      </DataTable>,
    );
    expect(screen.getByRole('table')).toHaveClass('cards');
    rerender(
      <DataTable columns={columns} cards={false}>
        <tr>
          <td>a</td>
          <td>b</td>
        </tr>
      </DataTable>,
    );
    expect(screen.getByRole('table')).not.toHaveClass('cards');
  });

  it('MemberRow cells carry the label of their column, so a card shows it before each value', () => {
    render(
      <DataTable columns={memberColumns}>
        <MemberRow row={member} onChangeRole={() => undefined} onRemove={() => undefined} />
      </DataTable>,
    );
    const cells = screen.getAllByRole('cell');
    expect(cells[0]).toHaveAttribute('data-label', 'Name');
    expect(cells[1]).toHaveAttribute('data-label', 'Access');
    expect(screen.getByRole('button', { name: 'Actions for Cleo Martin' })).toBeVisible();
  });
});
