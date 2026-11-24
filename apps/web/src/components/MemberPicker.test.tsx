import { useState } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { manyPickerOptions, memberPickerOptions } from '@/mocks';
import type { MemberPickerOption } from '@/mocks/types';
import { MemberPicker, PICKER_OVERSCAN, PICKER_ROWS, shouldLoadMore, type MemberPickerProps } from './MemberPicker';

// jsdom has no layout: give the scroll container a fixed 8-row viewport so the virtualizer measures it.
const ROW = 36;
const stubbed = ['clientHeight', 'clientWidth'] as const;
const originals = new Map<string, PropertyDescriptor | undefined>();
beforeEach(() => {
  for (const key of stubbed) {
    originals.set(key, Object.getOwnPropertyDescriptor(HTMLElement.prototype, key));
    Object.defineProperty(HTMLElement.prototype, key, {
      configurable: true,
      value: key === 'clientHeight' ? PICKER_ROWS * ROW : 300,
    });
  }
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  for (const key of stubbed) {
    const was = originals.get(key);
    if (was) Object.defineProperty(HTMLElement.prototype, key, was);
    else Reflect.deleteProperty(HTMLElement.prototype, key);
  }
});

function setup(over: Partial<MemberPickerProps> = {}) {
  const handlers = { onQueryChange: vi.fn(), onPick: vi.fn(), onLoadMore: vi.fn() };
  const props: MemberPickerProps = {
    query: '',
    options: memberPickerOptions,
    total: memberPickerOptions.length,
    hasMore: false,
    state: { kind: 'idle' },
    picked: null,
    orgName: 'Acme',
    ...handlers,
    ...over,
  };
  const view = render(<MemberPicker {...props} />);
  return { ...handlers, ...view, props };
}

describe('shouldLoadMore', () => {
  const base = { lastRenderedIndex: 14, loadedCount: 20, hasMore: true, loading: false };
  it('loads when the last rendered row is within 5 rows of the end', () => {
    expect(shouldLoadMore(base)).toBe(true);
    expect(shouldLoadMore({ ...base, lastRenderedIndex: 13 })).toBe(false);
  });
  it('does not load without more pages, while loading, or with nothing loaded', () => {
    expect(shouldLoadMore({ ...base, hasMore: false })).toBe(false);
    expect(shouldLoadMore({ ...base, loading: true })).toBe(false);
    expect(shouldLoadMore({ ...base, loadedCount: 0 })).toBe(false);
  });
  it('honours a custom threshold', () => {
    expect(shouldLoadMore({ ...base, lastRenderedIndex: 10, threshold: 9 })).toBe(true);
  });
});

describe('MemberPicker semantics', () => {
  it('has no aria-controls while there is no listbox to control', async () => {
    const user = userEvent.setup();
    setup({ options: [], total: 0 });
    const box = screen.getByRole('combobox');
    await user.click(box);
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(box).not.toHaveAttribute('aria-controls');
    expect(box).toHaveAttribute('aria-expanded', 'false');
  });

  it('is a combobox that controls a listbox and names the active option', async () => {
    const user = userEvent.setup();
    setup();
    const box = screen.getByRole('combobox');
    expect(box).toHaveAttribute('aria-expanded', 'false');
    await user.click(box);
    expect(box).toHaveAttribute('aria-expanded', 'true');
    const list = screen.getByRole('listbox');
    expect(box).toHaveAttribute('aria-controls', list.id);
    await user.keyboard('{ArrowDown}');
    const active = box.getAttribute('aria-activedescendant');
    expect(active).toBeTruthy();
    expect(document.getElementById(active ?? '')).toHaveAttribute('role', 'option');
  });

  it('sets aria-setsize to the total and a 1-based aria-posinset', async () => {
    const user = userEvent.setup();
    setup({ total: 45 });
    await user.click(screen.getByRole('combobox'));
    const opts = screen.getAllByRole('option');
    expect(opts[0]).toHaveAttribute('aria-setsize', '45');
    expect(opts[0]).toHaveAttribute('aria-posinset', '1');
    expect(opts[2]).toHaveAttribute('aria-posinset', '3');
  });

  it('renders only the visible window of 60 loaded people', async () => {
    const user = userEvent.setup();
    setup({ options: manyPickerOptions.slice(0, 60), total: 200, hasMore: true });
    await user.click(screen.getByRole('combobox'));
    const n = screen.getAllByRole('option').length;
    expect(n).toBeLessThan(60);
    expect(n).toBeGreaterThanOrEqual(PICKER_ROWS);
    expect(PICKER_OVERSCAN).toBe(5);
  });

  it('limits the input to 100 characters', () => {
    setup();
    expect(screen.getByRole('combobox')).toHaveAttribute('maxlength', '100');
  });

  it('reports typing through onQueryChange', async () => {
    const user = userEvent.setup();
    const { onQueryChange } = setup();
    await user.click(screen.getByRole('combobox'));
    await user.keyboard('a');
    expect(onQueryChange).toHaveBeenCalledWith('a');
  });
});

describe('MemberPicker keyboard', () => {
  it('moves with ArrowDown, ArrowUp, Home and End and picks with Enter', async () => {
    const user = userEvent.setup();
    const { onPick } = setup();
    const box = screen.getByRole('combobox');
    await user.click(box);
    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowUp}');
    expect(document.getElementById(box.getAttribute('aria-activedescendant') ?? '')).toHaveTextContent('Mira Chen');
    await user.keyboard('{End}');
    expect(document.getElementById(box.getAttribute('aria-activedescendant') ?? '')).toHaveTextContent('Eli Ford');
    await user.keyboard('{Home}');
    expect(document.getElementById(box.getAttribute('aria-activedescendant') ?? '')).toHaveTextContent('Mira Chen');
    await user.keyboard('{ArrowDown}{Enter}');
    expect(onPick).toHaveBeenCalledWith(memberPickerOptions[1]);
  });

  it('reaches "Load more people" with ArrowDown on the last option and loads once on Enter, keeping focus', async () => {
    const user = userEvent.setup();
    const { onLoadMore } = setup({ options: manyPickerOptions.slice(0, 20), hasMore: true, total: 200 });
    const box = screen.getByRole('combobox');
    await user.click(box);
    await user.keyboard('{End}{ArrowDown}');
    expect(document.getElementById(box.getAttribute('aria-activedescendant') ?? '')).toHaveTextContent(
      'Load more people',
    );
    await user.keyboard('{Enter}');
    expect(onLoadMore).toHaveBeenCalledTimes(1);
    expect(box).toHaveFocus();
  });

  it('moves the active option to the first new person after a page loads', async () => {
    const user = userEvent.setup();
    function Harness() {
      const [opts, setOpts] = useState<MemberPickerOption[]>(manyPickerOptions.slice(0, 20));
      return (
        <MemberPicker
          query=""
          onQueryChange={vi.fn()}
          options={opts}
          total={200}
          hasMore
          state={{ kind: 'idle' }}
          picked={null}
          onPick={vi.fn()}
          onLoadMore={() => setOpts(manyPickerOptions.slice(0, 40))}
          orgName="Acme"
        />
      );
    }
    render(<Harness />);
    const box = screen.getByRole('combobox');
    await user.click(box);
    await user.keyboard('{End}{ArrowDown}{Enter}');
    expect(document.getElementById(box.getAttribute('aria-activedescendant') ?? '')).toHaveTextContent('Person 021');
  });

  it('closes the list on the first Escape and lets the second reach the dialog', async () => {
    const user = userEvent.setup();
    const outer = vi.fn();
    render(
      <div onKeyDown={(e) => e.key === 'Escape' && outer()}>
        <MemberPicker
          query=""
          onQueryChange={vi.fn()}
          options={memberPickerOptions}
          total={5}
          hasMore={false}
          state={{ kind: 'idle' }}
          picked={null}
          onPick={vi.fn()}
          onLoadMore={vi.fn()}
          orgName="Acme"
        />
      </div>,
    );
    const box = screen.getByRole('combobox');
    await user.click(box);
    await user.keyboard('{Escape}');
    expect(box).toHaveAttribute('aria-expanded', 'false');
    expect(outer).not.toHaveBeenCalled();
    await user.keyboard('{Escape}');
    expect(outer).toHaveBeenCalledTimes(1);
  });

  it('picks a person by click and closes the list', async () => {
    const user = userEvent.setup();
    const { onPick } = setup();
    await user.click(screen.getByRole('combobox'));
    await user.click(screen.getByRole('option', { name: /Kim Hale/ }));
    expect(onPick).toHaveBeenCalledWith(memberPickerOptions[1]);
    expect(screen.queryByRole('listbox')).toBeNull();
  });
});

describe('MemberPicker paging', () => {
  it('asks for the next page once when the list end is within reach', async () => {
    const user = userEvent.setup();
    const { onLoadMore } = setup({ options: manyPickerOptions.slice(0, 12), hasMore: true, total: 200 });
    await user.click(screen.getByRole('combobox'));
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it('does not ask while the end is far away or after a failed page', async () => {
    const user = userEvent.setup();
    const far = setup({ options: manyPickerOptions.slice(0, 40), hasMore: true, total: 200 });
    await user.click(screen.getByRole('combobox'));
    expect(far.onLoadMore).not.toHaveBeenCalled();
    far.unmount();
    const failed = setup({
      options: manyPickerOptions.slice(0, 12),
      hasMore: true,
      total: 200,
      state: { kind: 'loadMoreError', onRetry: vi.fn() },
    });
    await user.click(screen.getByRole('combobox'));
    expect(failed.onLoadMore).not.toHaveBeenCalled();
  });
});

describe('MemberPicker paging after a new search', () => {
  it('loads the next page again when a new query returns as many people as an earlier request', async () => {
    const user = userEvent.setup();
    const onLoadMore = vi.fn();
    const props = {
      onQueryChange: vi.fn(),
      total: 200,
      hasMore: true,
      state: { kind: 'idle' as const },
      picked: null,
      onPick: vi.fn(),
      onLoadMore,
      orgName: 'Acme',
    };
    const first = manyPickerOptions.slice(0, 20);
    const { rerender } = render(<MemberPicker {...props} query="" options={first} />);
    const box = screen.getByRole('combobox');
    await user.click(box);
    await user.keyboard('{End}{ArrowDown}{Enter}');
    expect(onLoadMore).toHaveBeenCalledTimes(1);
    rerender(<MemberPicker {...props} query="" options={manyPickerOptions.slice(0, 40)} />);
    rerender(<MemberPicker {...props} query="al" options={manyPickerOptions.slice(40, 60)} />);
    await user.keyboard('{End}{ArrowDown}{Enter}');
    expect(onLoadMore).toHaveBeenCalledTimes(2);
  });
});

describe('MemberPicker states', () => {
  it('shows Loading people… while the first page loads', async () => {
    const user = userEvent.setup();
    setup({ options: [], total: 0, state: { kind: 'loading' } });
    await user.click(screen.getByRole('combobox'));
    expect(screen.getByText('Loading people…')).toBeInTheDocument();
  });

  it('keeps the previous options and says Searching…', async () => {
    const user = userEvent.setup();
    setup({ state: { kind: 'searching' } });
    await user.click(screen.getByRole('combobox'));
    expect(screen.getByRole('status')).toHaveTextContent('Searching…');
    expect(screen.getAllByRole('option')).toHaveLength(5);
  });

  it('does not say no member matches while a search with no results yet is running', async () => {
    const user = userEvent.setup();
    setup({ options: [], total: 0, query: 'zzz', state: { kind: 'searching' } });
    await user.click(screen.getByRole('combobox'));
    expect(screen.queryByText(/No member matches/)).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('Searching…');
  });

  it('shows the error with Try again', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    setup({ options: [], total: 0, state: { kind: 'error', onRetry } });
    await user.click(screen.getByRole('combobox'));
    expect(screen.getByText('Could not load people.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('says no member matches the search', async () => {
    const user = userEvent.setup();
    setup({ options: [], total: 0, query: 'zz' });
    await user.click(screen.getByRole('combobox'));
    expect(screen.getByText('No member matches "zz".')).toBeInTheDocument();
  });

  it('says everyone already has a role when the first page is empty without a search', async () => {
    const user = userEvent.setup();
    setup({ options: [], total: 0 });
    await user.click(screen.getByRole('combobox'));
    expect(screen.getByText('Everyone in Acme already has a role here.')).toBeInTheDocument();
  });

  it('shows Loading… at the end while keeping the loaded people', async () => {
    const user = userEvent.setup();
    setup({ hasMore: true, state: { kind: 'loadingMore' } });
    await user.click(screen.getByRole('combobox'));
    expect(screen.getByText('Loading…')).toBeInTheDocument();
    expect(screen.getAllByRole('option')).toHaveLength(5);
  });

  it('shows the load-more error with Try again and keeps the loaded people', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    setup({ hasMore: true, state: { kind: 'loadMoreError', onRetry } });
    await user.click(screen.getByRole('combobox'));
    expect(screen.getByText('Could not load more people.')).toBeInTheDocument();
    expect(screen.getAllByRole('option')).toHaveLength(5);
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('announces the people count', async () => {
    const user = userEvent.setup();
    setup({ total: 5 });
    await user.click(screen.getByRole('combobox'));
    expect(screen.getByRole('status')).toHaveTextContent('5 people');
  });

  it('announces how many more people loaded after a page', async () => {
    const user = userEvent.setup();
    const props = {
      query: '',
      onQueryChange: vi.fn(),
      total: 20,
      hasMore: true,
      state: { kind: 'idle' as const },
      picked: null,
      onPick: vi.fn(),
      onLoadMore: vi.fn(),
      orgName: 'Acme',
    };
    const { rerender } = render(<MemberPicker {...props} options={manyPickerOptions.slice(0, 5)} />);
    await user.click(screen.getByRole('combobox'));
    rerender(<MemberPicker {...props} options={manyPickerOptions.slice(0, 12)} />);
    expect(within(screen.getByRole('status')).getByText('7 more people loaded')).toBeInTheDocument();
  });
});

describe('MemberPicker picked person', () => {
  it('shows "Name (handle)" in the field', () => {
    setup({ picked: { userId: 'u', name: 'Mira Chen', handle: 'mira' } });
    expect(screen.getByRole('combobox')).toHaveValue('Mira Chen (mira)');
  });
  it('shows "Name" when the handle is null', () => {
    setup({ picked: { userId: 'u', name: 'Noor Haddad', handle: null } });
    expect(screen.getByRole('combobox')).toHaveValue('Noor Haddad');
  });
});
