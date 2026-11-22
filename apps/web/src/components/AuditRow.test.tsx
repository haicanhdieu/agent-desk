import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { auditRows } from '@/mocks';
import type { AuditRowView } from '@/mocks/types';
import { AuditRow, auditColumns } from './AuditRow';

function rowAt(i: number): AuditRowView {
  const r = auditRows[i];
  if (!r) throw new Error(`no audit row ${i}`);
  return r;
}

function renderRow(row: AuditRowView) {
  return render(
    <table>
      <tbody>
        <AuditRow row={row} />
      </tbody>
    </table>,
  );
}

describe('AuditRow', () => {
  it('names the columns When, Who, What', () => {
    expect(auditColumns.map((c) => c.header)).toEqual(['When', 'Who', 'What']);
  });

  it('shows When as a time with the exact date in the title and for screen readers', () => {
    const row = rowAt(0);
    const { container } = renderRow(row);
    const time = container.querySelector('time');
    expect(time).toHaveAttribute('dateTime', row.when.iso);
    expect(time).toHaveAttribute('title', row.when.exact);
    expect(time).toHaveTextContent(row.when.label);
    expect(within(time as HTMLElement).getByText(row.when.exact)).toHaveClass('sr-only');
  });

  it('separates the visible label from the screen-reader date', () => {
    const row = rowAt(0);
    const { container } = renderRow(row);
    expect((container.querySelector('time') as HTMLElement).textContent).toBe(`${row.when.label} ${row.when.exact}`);
  });

  it('shows the actor label with no tag for a plain actor', () => {
    renderRow(rowAt(0));
    expect(screen.getAllByRole('cell')[1]).toHaveTextContent(/^Alice Doe$/);
  });

  it('tags a platform admin actor', () => {
    renderRow(rowAt(7));
    const who = screen.getAllByRole('cell')[1];
    expect(who).toHaveTextContent('Pat Platform');
    expect(who).toHaveTextContent('Platform admin');
  });

  it('tags a deleted actor', () => {
    renderRow(rowAt(8));
    expect(screen.getAllByRole('cell')[1]).toHaveTextContent('Deleted user');
  });

  it('renders a sentence with strong parts in bold and the full sentence as title', () => {
    const row = rowAt(0);
    const { container } = renderRow(row);
    const what = screen.getAllByRole('cell')[2] as HTMLElement;
    expect(what).toHaveTextContent("Alice Doe changed Cleo Martin's role from Admin to Member");
    expect(Array.from(container.querySelectorAll('b')).map((b) => b.textContent)).toEqual(['Alice Doe', 'Cleo Martin']);
    expect(what.querySelector('[title]')).toHaveAttribute(
      'title',
      "Alice Doe changed Cleo Martin's role from Admin to Member",
    );
  });

  it('renders a raw entry with the key in mono and the target', () => {
    const row: AuditRowView = { ...rowAt(6), what: { kind: 'raw', key: 'POST orgs.create', target: 'Harbor' } };
    renderRow(row);
    expect(screen.getByText('POST orgs.create')).toHaveClass('mono');
    expect(screen.getAllByRole('cell')[2]).toHaveTextContent('Harbor');
  });

  it('gives a raw entry a title with the key and target, with the key alone when there is no target', () => {
    const withTarget: AuditRowView = { ...rowAt(6), what: { kind: 'raw', key: 'POST orgs.create', target: 'Harbor' } };
    const { container, unmount } = renderRow(withTarget);
    expect(container.querySelector('[title="POST orgs.create Harbor"]')).not.toBeNull();
    unmount();
    const { container: bare } = renderRow(rowAt(6));
    expect(bare.querySelector('[title="POST orgs.create"]')).not.toBeNull();
  });

  it('renders a raw entry without a target', () => {
    renderRow(rowAt(6));
    expect(screen.getByText('POST orgs.create')).toHaveClass('mono');
  });

  it('renders an email and HTML-like text literally, never as a link or markup', () => {
    const { container } = renderRow(rowAt(9));
    expect(container.querySelector('a')).toBeNull();
    expect(container.querySelector('b b')).toBeNull();
    expect(screen.getAllByRole('cell')[2]).toHaveTextContent('<b>long-invitee-');
    const mail: AuditRowView = {
      ...rowAt(5),
      what: { kind: 'sentence', parts: [{ text: 'sam.reyes@contractor.io', strong: true }], title: 'x' },
    };
    const second = renderRow(mail);
    expect(second.container.querySelector('a')).toBeNull();
    expect(second.container).toHaveTextContent('sam.reyes@contractor.io');
  });
});
