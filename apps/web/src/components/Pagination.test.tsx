import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Pagination, formatCount, pageItems, type PaginationProps } from './Pagination';

describe('pageItems', () => {
  it.each([
    [1, 50, [1, 2, 'gap', 50]],
    [50, 50, [1, 'gap', 49, 50]],
    [25, 50, [1, 'gap', 24, 25, 26, 'gap', 50]],
    [3, 5, [1, 2, 3, 4, 5]],
    [1, 3, [1, 2, 3]],
    [4, 50, [1, 'gap', 3, 4, 5, 'gap', 50]],
    [1, 1, [1]],
  ])('wide set for page %i of %i', (page, count, expected) => {
    expect(pageItems(page, count, 'wide')).toEqual(expected);
  });

  it.each([
    [25, 50, [1, 'gap', 25, 'gap', 50]],
    [1, 50, [1, 'gap', 50]],
    [2, 50, [1, 2, 'gap', 50]],
  ])('narrow set for page %i of %i', (page, count, expected) => {
    expect(pageItems(page, count, 'narrow')).toEqual(expected);
  });
});

describe('formatCount', () => {
  it('groups thousands', () => {
    expect(formatCount(1000)).toBe('1,000');
    expect(formatCount(12480)).toBe('12,480');
  });
});

function setup(over: Partial<PaginationProps> = {}) {
  const props: PaginationProps = {
    page: 25,
    pageSize: 20,
    total: 1000,
    onPageChange: vi.fn(),
    onPageSizeChange: vi.fn(),
    ...over,
  };
  const user = userEvent.setup();
  render(<Pagination {...props} />);
  return { props, user };
}

// Without CSS (jsdom) the wide, the narrow and the current-only sets are all in the tree; the wide list comes first.
const wide = () => within(screen.getAllByRole('list')[0]);
const jumpBox = () => screen.getByRole('textbox', { name: 'Go to page' });
const go = () => screen.getByRole('button', { name: 'Go' });

describe('Pagination', () => {
  it('renders nothing at 20 rows or fewer', () => {
    for (const total of [0, 15, 20]) {
      const { unmount } = render(
        <Pagination page={1} pageSize={20} total={total} onPageChange={vi.fn()} onPageSizeChange={vi.fn()} />,
      );
      expect(screen.queryByRole('navigation')).toBeNull();
      unmount();
    }
    setup({ page: 1, total: 21 });
    expect(screen.getByRole('navigation', { name: 'Pagination' })).toBeInTheDocument();
  });

  it('shows the range and page buttons', () => {
    setup();
    expect(
      screen.getByText((_, el) => el?.tagName === 'P' && el.textContent === 'Showing 481–500 of 1,000'),
    ).toBeInTheDocument();
    for (const n of [1, 24, 25, 26, 50]) expect(wide().getByRole('button', { name: `Page ${n}` })).toBeInTheDocument();
    expect(wide().getByRole('button', { name: 'Page 25' })).toHaveAttribute('aria-current', 'page');
    expect(wide().getByRole('button', { name: 'Page 24' })).not.toHaveAttribute('aria-current');
    for (const gap of screen.getAllByText('…')) expect(gap).toHaveAttribute('aria-hidden', 'true');
  });

  it('names the current-page-only element "Page N" with aria-current', () => {
    setup();
    const only = screen.getByText((_, el) => el?.tagName === 'SPAN' && el.textContent === 'Page 25');
    expect(only).toHaveAttribute('aria-current', 'page');
  });

  it('drops the range when the page is past the last page', () => {
    setup({ page: 60 });
    expect(screen.queryByText(/Showing/)).toBeNull();
    expect(screen.queryByText(/1,181/)).toBeNull();
  });

  it('disables Previous on page 1 and Next on the last page', () => {
    const { unmount } = render(
      <Pagination page={1} pageSize={20} total={1000} onPageChange={vi.fn()} onPageSizeChange={vi.fn()} />,
    );
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled();
    unmount();
    setup({ page: 50 });
    expect(screen.getByRole('button', { name: 'Previous' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
  });

  it('Previous and Next call onPageChange with page ∓ 1', async () => {
    const { props, user } = setup();
    await user.click(screen.getByRole('button', { name: 'Previous' }));
    expect(props.onPageChange).toHaveBeenLastCalledWith(24);
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(props.onPageChange).toHaveBeenLastCalledWith(26);
  });

  it('clicking a page button calls onPageChange with its number', async () => {
    const { props, user } = setup();
    await user.click(wide().getByRole('button', { name: 'Page 50' }));
    expect(props.onPageChange).toHaveBeenCalledWith(50);
  });

  it('Go is disabled while the box is empty and clamps the jump', async () => {
    const { props, user } = setup();
    expect(go()).toBeDisabled();
    expect(jumpBox()).toHaveAttribute('inputmode', 'numeric');
    for (const [typed, expected] of [
      ['80', 50],
      ['0', 1],
      ['-3', 1],
      ['99999999999999999999', 50],
    ] as const) {
      await user.type(jumpBox(), typed);
      await user.click(go());
      expect(props.onPageChange).toHaveBeenLastCalledWith(expected);
      expect(jumpBox()).toHaveValue('');
    }
    await user.type(jumpBox(), '10{Enter}');
    expect(props.onPageChange).toHaveBeenLastCalledWith(10);
    await user.type(jumpBox(), 'abc');
    expect(jumpBox()).toHaveValue('');
    expect(go()).toBeDisabled();
  });

  it('Rows per page offers exactly 20, 50 and 100', async () => {
    const { props, user } = setup();
    const select = screen.getByRole('combobox', { name: 'Rows per page' });
    expect(
      within(select)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['20', '50', '100']);
    await user.selectOptions(select, '50');
    expect(props.onPageSizeChange).toHaveBeenCalledWith(50);
  });

  it('busy marks the nav and disables every control', () => {
    setup({ busy: true });
    expect(screen.getByRole('navigation')).toHaveAttribute('aria-busy', 'true');
    for (const b of screen.getAllByRole('button')) expect(b).toBeDisabled();
    expect(jumpBox()).toBeDisabled();
    expect(screen.getByRole('combobox', { name: 'Rows per page' })).toBeDisabled();
  });
});
