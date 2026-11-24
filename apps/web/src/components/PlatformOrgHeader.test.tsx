import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { PlatformOrgHeader, type PlatformOrgHeaderProps } from './PlatformOrgHeader';

function setup(over: Partial<PlatformOrgHeaderProps> = {}) {
  const handlers = { onSuspend: vi.fn(), onReactivate: vi.fn() };
  render(
    <PlatformOrgHeader
      name="Acme"
      slug="acme"
      status="active"
      auditHref="/platform/audit?org=1"
      {...handlers}
      {...over}
    />,
  );
  return handlers;
}

describe('PlatformOrgHeader', () => {
  it('shows the name as a focusable h1, the slug path and the status', () => {
    setup();
    const h1 = screen.getByRole('heading', { level: 1, name: 'Acme' });
    expect(h1).toHaveAttribute('tabindex', '-1');
    expect(screen.getByText('/o/acme')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
  });

  it('offers Suspend for an active org', async () => {
    const h = setup();
    expect(screen.queryByRole('button', { name: 'Reactivate organization' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Suspend organization' }));
    expect(h.onSuspend).toHaveBeenCalled();
  });

  it('styles Suspend organization as danger', () => {
    setup();
    expect(screen.getByRole('button', { name: 'Suspend organization' })).toHaveClass('danger');
  });

  it('styles Reactivate organization as the default button', () => {
    setup({ status: 'suspended' });
    const b = screen.getByRole('button', { name: 'Reactivate organization' });
    expect(b).toHaveClass('btn');
    for (const v of ['danger', 'solid-danger', 'primary', 'go', 'ghost']) expect(b).not.toHaveClass(v);
  });

  it('offers Reactivate for a suspended org', async () => {
    const h = setup({ status: 'suspended' });
    expect(screen.getByText('Suspended')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Suspend organization' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Reactivate organization' }));
    expect(h.onReactivate).toHaveBeenCalled();
  });

  it('links to the audit log', () => {
    setup();
    expect(screen.getByRole('link', { name: 'View audit log' })).toHaveAttribute('href', '/platform/audit?org=1');
  });

  it('has no Edit button without onEdit', () => {
    setup();
    expect(screen.queryByRole('button', { name: 'Edit organization' })).toBeNull();
  });

  it('calls onEdit from the Edit organization button', async () => {
    const onEdit = vi.fn();
    setup({ onEdit });
    await userEvent.click(screen.getByRole('button', { name: 'Edit organization' }));
    expect(onEdit).toHaveBeenCalled();
  });

  it.each(['active', 'suspended'] as const)(
    'orders actions Edit, status action, then the audit link (%s)',
    (status) => {
      setup({ status, onEdit: vi.fn() });
      const els = [
        screen.getByRole('button', { name: 'Edit organization' }),
        screen.getByRole('button', { name: status === 'active' ? 'Suspend organization' : 'Reactivate organization' }),
        screen.getByRole('link', { name: 'View audit log' }),
      ];
      expect(els[0].compareDocumentPosition(els[1]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(els[1].compareDocumentPosition(els[2]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    },
  );

  it('shows "Open organization" after "View audit log" only with openHref', () => {
    const { unmount } = render(
      <PlatformOrgHeader
        name="Acme"
        slug="acme"
        status="active"
        auditHref="/platform/audit?org=1"
        openHref="/o/acme/projects"
        onSuspend={vi.fn()}
        onReactivate={vi.fn()}
      />,
    );
    expect(screen.getAllByRole('link').map((l) => l.textContent)).toEqual(['View audit log', 'Open organization']);
    expect(screen.getByRole('link', { name: 'Open organization' })).toHaveAttribute('href', '/o/acme/projects');
    unmount();
    setup();
    expect(screen.queryByRole('link', { name: 'Open organization' })).not.toBeInTheDocument();
  });
});
