import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { deskFrame, pagedAuditLastPage, projectAuditRows } from '@/mocks';
import { DeskAudit, type DeskAuditProps } from './DeskAudit';

const frame = {
  ...deskFrame,
  links: {
    projects: '#projects',
    runs: '#runs',
    desk: '#desk',
    skills: '#skills',
    rules: '#rules',
    agent: '#agent',
    members: '#members',
    audit: '#audit',
  },
};
const ready = (over: Partial<Extract<DeskAuditProps['state'], { kind: 'ready' }>> = {}): DeskAuditProps => ({
  frame,
  state: { kind: 'ready', rows: projectAuditRows, ...over },
});

describe('DeskAudit', () => {
  it('BR-16: ready shows the h1, the intro, the When, Who and What columns and one row per entry', () => {
    render(<DeskAudit {...ready()} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Audit log' })).toBeInTheDocument();
    expect(screen.getByText('Changes to this project, newest first.')).toBeInTheDocument();
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['When', 'Who', 'What']);
    expect(screen.getAllByRole('row').slice(1)).toHaveLength(projectAuditRows.length);
    expect(screen.getByText('Deleted user')).toBeInTheDocument();
  });

  it('BR-16: paging reads Showing 21-25 of 25 on page 2', () => {
    render(
      <DeskAudit
        {...ready({
          rows: pagedAuditLastPage,
          pagination: { page: 2, pageSize: 20, total: 25, onPageChange: vi.fn(), onPageSizeChange: vi.fn() },
        })}
      />,
    );
    expect(screen.getByRole('navigation', { name: 'Pagination' })).toHaveTextContent('Showing 21–25 of 25');
  });

  it('BR-20: loading is a busy status with no heading', () => {
    render(<DeskAudit frame={frame} state={{ kind: 'loading' }} />);
    expect(screen.getByRole('status', { name: 'Loading' })).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument();
  });

  it('BR-20: error shows the banner, the request ID and Retry', async () => {
    const onRetry = vi.fn();
    render(<DeskAudit frame={frame} state={{ kind: 'error', requestId: 'req_01JD7Q3M8V2K', onRetry }} />);
    expect(screen.getByText('Internal server error')).toBeInTheDocument();
    expect(screen.getByText(/Request ID: req_01JD7Q3M8V2K/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('BR-20: no entries shows No activity yet', () => {
    render(<DeskAudit {...ready({ rows: [] })} />);
    expect(screen.getByRole('heading', { name: 'No activity yet' })).toBeInTheDocument();
  });

  it('BR-1: the side menu marks Audit log as the current item', () => {
    render(<DeskAudit {...ready()} />);
    expect(screen.getByRole('link', { name: /Audit log/ })).toHaveAttribute('aria-current', 'page');
  });
});
