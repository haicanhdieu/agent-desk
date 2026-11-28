import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { pagedPlatformOrgRows, platformOrgRows, type PlatformOrgRowView } from '@/mocks/platform/orgs';
import { PlatformOrgRow, platformOrgColumns } from './PlatformOrgRow';

const base: PlatformOrgRowView = {
  id: 'o1',
  name: 'Acme Inc',
  slug: 'acme',
  href: '/o/acme',
  owner: 'owner@acme.test',
  members: 4,
  projects: 2,
  lastActivity: { label: '5 min ago', title: 'Nov 23, 2026, 10:00 UTC' },
  status: 'active',
  created: { label: 'Nov 1, 2026', title: 'Nov 1, 2026, 08:00 UTC' },
};

function renderRow(over: Partial<PlatformOrgRowView> = {}) {
  return render(
    <table>
      <tbody>
        <PlatformOrgRow row={{ ...base, ...over }} />
      </tbody>
    </table>,
  );
}

describe('PlatformOrgRow', () => {
  it('has the columns Organization, Owner, Members, Projects, Last activity, Status, Created', () => {
    expect(platformOrgColumns.map((c) => c.header)).toEqual([
      'Organization',
      'Owner',
      'Members',
      'Projects',
      'Last activity',
      'Status',
      'Created',
    ]);
  });

  it('links the name to href with the slug in mono beside it', () => {
    renderRow();
    expect(screen.getByRole('link', { name: 'Acme Inc' })).toHaveAttribute('href', '/o/acme');
    expect(screen.getByText('/o/acme')).toBeInTheDocument();
  });

  it('shows owner, counts and status', () => {
    renderRow();
    expect(screen.getByText('owner@acme.test')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
  });

  it('shows Suspended for a suspended org', () => {
    renderRow({ status: 'suspended' });
    expect(screen.getByText('Suspended')).toBeInTheDocument();
  });

  it('shows No owner yet and No activity yet', () => {
    renderRow({ owner: null, lastActivity: null });
    expect(screen.getByText('No owner yet')).toBeInTheDocument();
    expect(screen.getByText('No activity yet')).toBeInTheDocument();
  });

  it('carries the full date in the title of relative times', () => {
    renderRow();
    expect(screen.getByText('5 min ago')).toHaveAttribute('title', 'Nov 23, 2026, 10:00 UTC');
    expect(screen.getByText('Nov 1, 2026')).toHaveAttribute('title', 'Nov 1, 2026, 08:00 UTC');
  });

  it('ellipsizes a long name and keeps the full name in the title', () => {
    const name = 'A very long organization name '.repeat(6).trim();
    renderRow({ name });
    expect(screen.getByText(name)).toHaveAttribute('title', name);
  });

  it('renders markup in a name as text', () => {
    const name = '<img src=x onerror=alert(1)>';
    const { container } = renderRow({ name });
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText(name)).toBeInTheDocument();
  });

  it('has fixtures for each state and a 25-row page', () => {
    expect(platformOrgRows.some((r) => r.status === 'suspended')).toBe(true);
    expect(platformOrgRows.some((r) => r.owner === null)).toBe(true);
    expect(platformOrgRows.some((r) => r.lastActivity === null)).toBe(true);
    expect(pagedPlatformOrgRows).toHaveLength(25);
  });
});

describe('PlatformOrgRow phone card labels (BR-65)', () => {
  it('labels every cell with its column header', () => {
    renderRow();
    expect(screen.getAllByRole('cell').map((c) => c.getAttribute('data-label'))).toEqual(
      platformOrgColumns.map((c) => c.header),
    );
  });
});
