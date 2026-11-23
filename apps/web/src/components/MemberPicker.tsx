import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { defaultRangeExtractor, useVirtualizer } from '@tanstack/react-virtual';
import { Button, TextInput } from '@/ds';
import type { MemberPickerOption, MemberPickerState } from '@/mocks/types';
import styles from './MemberPicker.module.css';

export const PICKER_ROWS = 8;
export const PICKER_OVERSCAN = 5;
const ROW_PX = 36;
const LOAD_THRESHOLD = 5;
const MAX_QUERY = 100;
const LOAD_MORE_LABEL = 'Load more people';

export interface MemberPickerProps {
  id?: string;
  query: string;
  onQueryChange: (q: string) => void;
  options: MemberPickerOption[];
  total: number;
  hasMore: boolean;
  state: MemberPickerState;
  picked: MemberPickerOption | null;
  onPick: (o: MemberPickerOption) => void;
  onLoadMore: () => void;
  orgName: string;
  invalid?: boolean;
  describedBy?: string;
}

/** True when more people should load: hasMore, not already loading, and the last rendered index within `threshold` rows of the end. */
export function shouldLoadMore(a: {
  lastRenderedIndex: number;
  loadedCount: number;
  hasMore: boolean;
  loading: boolean;
  threshold?: number;
}): boolean {
  const { lastRenderedIndex, loadedCount, hasMore, loading, threshold = LOAD_THRESHOLD } = a;
  if (!hasMore || loading || loadedCount <= 0) return false;
  return lastRenderedIndex >= loadedCount - 1 - threshold;
}

const labelOf = (o: MemberPickerOption) => (o.handle ? `${o.name} (${o.handle})` : o.name);

/** A controlled combobox over a server-searched, paged, virtualized list. It never filters: the route owns the search. */
export function MemberPicker(p: MemberPickerProps) {
  const { options, hasMore, state, query, picked } = p;
  const autoId = useId();
  const id = p.id ?? `${autoId}-picker`;
  const listId = `${id}-list`;
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const scrollRef = useRef<HTMLDivElement>(null);
  const prevCount = useRef(options.length);
  const requestedAt = useRef(-1);
  const focusAfterLoad = useRef<number | null>(null);
  const [moreLoaded, setMoreLoaded] = useState(0);

  const busy = state.kind === 'loadingMore' || state.kind === 'searching' || state.kind === 'loading';
  const endRow = hasMore && options.length > 0;
  const count = options.length + (endRow ? 1 : 0);
  const loadMoreIndex = endRow && state.kind === 'idle' ? options.length : -1;

  // The active option is always rendered, so aria-activedescendant never names an element that is not in the DOM.
  const activeRef = useRef(active);
  activeRef.current = active;
  const virtualizer = useVirtualizer({
    rangeExtractor: (range) => {
      const idx = defaultRangeExtractor(range);
      const a = activeRef.current;
      return a >= 0 && a < range.count && !idx.includes(a) ? [...idx, a].sort((x, y) => x - y) : idx;
    },
    count,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_PX,
    overscan: PICKER_OVERSCAN,
  });
  const items = virtualizer.getVirtualItems();
  // The scroll window with overscan; the pinned active option does not count as scrolled to.
  const lastRendered = virtualizer.range?.endIndex ?? -1;

  // Scroll-driven paging: ask once per loaded count, and never while loading or after a failed page.
  useEffect(() => {
    if (!open) return;
    const loading = busy || state.kind === 'error' || state.kind === 'loadMoreError';
    if (requestedAt.current === options.length) return;
    if (shouldLoadMore({ lastRenderedIndex: lastRendered, loadedCount: options.length, hasMore, loading })) {
      requestedAt.current = options.length;
      p.onLoadMore();
    }
  }, [open, lastRendered, options.length, hasMore, busy, state.kind, p]);

  // A new search starts a new list: forget which page was asked for and any pending focus move.
  useEffect(() => {
    requestedAt.current = -1;
    focusAfterLoad.current = null;
  }, [query]);

  // Announce a loaded page and, after "Load more people", move the active option to the first new person.
  useEffect(() => {
    const before = prevCount.current;
    prevCount.current = options.length;
    if (options.length > before && before > 0) {
      setMoreLoaded(options.length - before);
      if (focusAfterLoad.current === before) {
        focusAfterLoad.current = null;
        setActive(before);
        virtualizer.scrollToIndex(before);
      }
    } else if (options.length !== before) {
      setMoreLoaded(0);
    }
  }, [options.length, virtualizer]);

  const optionId = (i: number) => `${id}-opt-${i}`;
  const moveTo = (i: number) => {
    if (count === 0) return;
    const next = Math.max(0, Math.min(count - 1, i));
    virtualizer.scrollToIndex(next);
    setActive(next);
  };
  const choose = (i: number) => {
    const o = options[i];
    if (o) {
      p.onPick(o);
      setOpen(false);
      setActive(-1);
    } else if (i === loadMoreIndex) {
      focusAfterLoad.current = options.length;
      // Scrolling may already have asked for this page.
      if (requestedAt.current !== options.length) {
        requestedAt.current = options.length;
        p.onLoadMore();
      }
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        if (!open) setOpen(true);
        moveTo(active + 1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        if (!open) setOpen(true);
        moveTo(active < 0 ? 0 : active - 1);
        break;
      case 'Home':
        if (open) {
          e.preventDefault();
          moveTo(0);
        }
        break;
      case 'End':
        if (open) {
          e.preventDefault();
          moveTo(options.length - 1);
        }
        break;
      case 'Enter':
        if (open && active >= 0) {
          e.preventDefault();
          choose(active);
        }
        break;
      case 'Escape':
        if (open) {
          e.preventDefault();
          e.stopPropagation();
          setOpen(false);
        }
        break;
    }
  };

  const showValue = picked && query === '' ? labelOf(picked) : query;
  const first = state.kind === 'loading' && options.length === 0;
  const failed = state.kind === 'error' && options.length === 0;
  const empty = state.kind === 'idle' && options.length === 0;
  const status =
    state.kind === 'searching'
      ? 'Searching…'
      : moreLoaded > 0
        ? `${moreLoaded} more people loaded`
        : options.length > 0
          ? `${p.total} people`
          : '';

  return (
    <div className={styles.picker}>
      <TextInput
        id={id}
        role="combobox"
        aria-expanded={open && count > 0}
        aria-controls={count > 0 ? listId : undefined}
        aria-autocomplete="list"
        aria-activedescendant={open && active >= 0 && count > 0 ? optionId(active) : undefined}
        aria-invalid={p.invalid ? true : undefined}
        aria-describedby={p.describedBy}
        autoComplete="off"
        maxLength={MAX_QUERY}
        placeholder="Search by name or handle"
        value={showValue}
        onChange={(e) => {
          setOpen(true);
          setActive(-1);
          p.onQueryChange(e.target.value);
        }}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onKeyDown={onKeyDown}
      />
      <div role="status" className={styles.status}>
        {open ? status : ''}
      </div>
      {open && (
        <div className={styles.panel}>
          {first && <div className={styles.note}>Loading people…</div>}
          {failed && state.kind === 'error' && (
            <div className={styles.note}>
              Could not load people.
              <Button size="sm" onClick={state.onRetry}>
                Try again
              </Button>
            </div>
          )}
          {empty && (
            <div className={styles.note}>
              {query.trim()
                ? `No member matches "${query.trim()}".`
                : `Everyone in ${p.orgName} already has a role here.`}
            </div>
          )}
          {count > 0 && (
            <div ref={scrollRef} className={styles.scroll} style={{ height: Math.min(count, PICKER_ROWS) * ROW_PX }}>
              <div
                id={listId}
                role="listbox"
                aria-label="People"
                className={styles.list}
                style={{ height: virtualizer.getTotalSize() }}
              >
                {items.map((v) => {
                  const o = options[v.index];
                  const style = { height: ROW_PX, transform: `translateY(${v.start}px)` };
                  if (o) {
                    return (
                      <div
                        key={o.userId}
                        id={optionId(v.index)}
                        role="option"
                        aria-selected={picked?.userId === o.userId}
                        aria-setsize={p.total}
                        aria-posinset={v.index + 1}
                        className={styles.option}
                        data-active={v.index === active || undefined}
                        style={style}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => choose(v.index)}
                      >
                        <span className={styles.name} title={o.name}>
                          {o.name}
                        </span>
                        {o.handle && <span className={styles.handle}>{o.handle}</span>}
                      </div>
                    );
                  }
                  if (state.kind === 'loadingMore') {
                    return (
                      <div key="end" role="presentation" className={styles.end} style={style}>
                        Loading…
                      </div>
                    );
                  }
                  if (state.kind === 'loadMoreError') {
                    return (
                      <div key="end" role="presentation" className={styles.end} style={style}>
                        Could not load more people.
                        <Button size="sm" onClick={state.onRetry}>
                          Try again
                        </Button>
                      </div>
                    );
                  }
                  return (
                    <div
                      key="end"
                      id={optionId(v.index)}
                      role="option"
                      aria-selected={false}
                      className={styles.option}
                      data-active={v.index === active || undefined}
                      style={style}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => choose(v.index)}
                    >
                      {LOAD_MORE_LABEL}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
