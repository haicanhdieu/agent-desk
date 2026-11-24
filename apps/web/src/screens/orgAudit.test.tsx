import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { auditRows, pagedAuditLastPage, platformSuspendAuditRows } from '@/mocks';
import { OrgAudit, type OrgAuditProps } from './OrgAudit';

const ready = (over: Partial<Extract<OrgAuditProps['state'], { kind: 'ready' }>> = {}): OrgAuditProps => ({
  state: { kind: 'ready', rows: auditRows, ...over },
});

const rowOf = (text: string): HTMLElement => {
  const tr = screen.getAllByRole('row').find((r) => r.textContent?.includes(text));
  if (!tr) throw new Error(`no row with ${text}`);
  return tr;
};

describe('OrgAudit', () => {
  it('BR-20, TC-20.1 (columns and order) and TC-20.7 (relative time): ready shows the h1 and the When, Who and What columns, one row per entry in the given order', () => {
    render(<OrgAudit {...ready()} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Audit log' })).toBeInTheDocument();
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['When', 'Who', 'What']);
    const body = screen.getAllByRole('row').slice(1);
    expect(body).toHaveLength(auditRows.length);
    body.forEach((tr, i) => {
      const what = auditRows[i]!.what;
      expect(tr).toHaveTextContent(what.kind === 'raw' ? what.key : what.parts.map((x) => x.text).join(''));
      expect(tr.querySelector('time')).toHaveTextContent(auditRows[i]!.when.label);
    });
  });

  it('BR-20, TC-20.4 (Deleted user), TC-20.5 (Platform admin tag) and TC-20.7 (raw key): the platform admin actor is tagged, a gone actor reads Deleted user, a generic row shows its raw key', () => {
    render(<OrgAudit {...ready()} />);
    expect(within(rowOf('Pat Platform')).getByText('Platform admin')).toBeInTheDocument();
    expect(within(rowOf("Cleo Martin's role from Viewer to Member")).getByText('Deleted user')).toBeInTheDocument();
    expect(screen.getByText('POST orgs.create')).toBeInTheDocument();
  });

  it('BR-20, TC-20.6: user text such as an HTML-like invitee email renders as text, not as markup', () => {
    const { container } = render(<OrgAudit {...ready()} />);
    expect(screen.getByText(/<b>long-invitee-/)).toBeInTheDocument();
    expect(container.querySelector('a')).toBeNull();
    expect(container.querySelector('td b b')).toBeNull();
  });

  it('BR-20, TC-20.3 (page 2): paging reads Showing 21–25 of 25 on page 2', () => {
    render(
      <OrgAudit
        {...ready({
          rows: pagedAuditLastPage,
          pagination: { page: 2, pageSize: 20, total: 25, onPageChange: vi.fn(), onPageSizeChange: vi.fn() },
        })}
      />,
    );
    expect(screen.getAllByRole('row')).toHaveLength(6);
    expect(screen.getByRole('navigation', { name: 'Pagination' })).toHaveTextContent('Showing 21–25 of 25');
  });

  it('BR-24, TC-24.3: loading is a busy status with no heading', () => {
    render(<OrgAudit state={{ kind: 'loading' }} />);
    expect(screen.getByRole('status', { name: 'Loading' })).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument();
  });

  it('BR-24, TC-24.4: the error shows the title and request id, and Retry calls onRetry', async () => {
    const onRetry = vi.fn();
    render(<OrgAudit state={{ kind: 'error', requestId: 'req_01JD7Q3M8V2K', onRetry }} />);
    expect(screen.getByText('Internal server error')).toBeInTheDocument();
    expect(screen.getByText('Request ID: req_01JD7Q3M8V2K')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('BR-24, TC-24.5: no entries shows No activity yet under the h1', () => {
    render(<OrgAudit {...ready({ rows: [] })} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Audit log' })).toBeInTheDocument();
    expect(screen.getByText('No activity yet')).toBeInTheDocument();
  });

  it('BR-2: forbidden shows the no-access notice and no table', () => {
    render(<OrgAudit state={{ kind: 'forbidden' }} />);
    expect(screen.getByRole('heading', { level: 1, name: "You don't have access" })).toBeInTheDocument();
    expect(screen.getByText('Ask an owner of this organization to give you access.')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
});

describe('OrgAudit platform suspend rows', () => {
  it('BR-43: suspend and reactivate rows tag the actor "Platform admin" and show no reason', () => {
    render(<OrgAudit state={{ kind: 'ready', rows: platformSuspendAuditRows }} />);
    const reactivated = rowOf('Morgan Avery reactivated the organization');
    const suspended = rowOf('Morgan Avery suspended the organization');
    expect(within(reactivated).getByText('Platform admin')).toBeInTheDocument();
    expect(within(suspended).getByText('Platform admin')).toBeInTheDocument();
    expect(screen.queryByText(/reason/i)).not.toBeInTheDocument();
  });
});
