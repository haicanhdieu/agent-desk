import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { PlatformProjectRowView } from '@/mocks/platform/tabs';
import { PlatformProjectRow, platformProjectColumns } from './PlatformProjectRow';

const base: PlatformProjectRowView = { id: 'p1000000-0000-4000-8000-000000000001', name: 'Alpha' };

function renderRow(over: Partial<PlatformProjectRowView> = {}) {
  return render(
    <table>
      <tbody>
        <PlatformProjectRow row={{ ...base, ...over }} />
      </tbody>
    </table>,
  );
}

describe('PlatformProjectRow', () => {
  it('BR-71: names the columns Name then Id', () => {
    expect(platformProjectColumns.map((c) => c.header)).toEqual(['Name', 'Id']);
  });

  it('BR-71: shows the name cell before the id cell', () => {
    const { container } = renderRow();
    const cells = [...container.querySelectorAll('td')].map((td) => td.textContent);
    expect(cells).toEqual(['Alpha', base.id]);
  });

  it('shows the id in mono with an ellipsis class and the full value in title', () => {
    renderRow();
    const id = screen.getByText(base.id);
    expect(id).toHaveAttribute('title', base.id);
    expect(id).toHaveClass('id');
  });

  it('shows the name as plain text with no link and no action (BR-25)', () => {
    const { container } = renderRow();
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(container.querySelector('a')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('renders markup in a name as text', () => {
    const { container } = renderRow({ name: '<b>Bold</b>' });
    expect(screen.getByText('<b>Bold</b>')).toBeInTheDocument();
    expect(container.querySelector('b')).toBeNull();
  });
});
