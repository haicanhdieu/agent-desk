import type { ReactNode } from 'react';
import { Button, Icon, SearchInput, StatusIcon } from '@/ds';
import { FilterChip, FilterChips, PageHeader } from '@/components';
import styles from './Screens.module.css';

export type RunsFilter = 'needs_you' | 'active' | 'queued' | 'ended' | 'all' | 'ignored';

/** The search box above the list: the text in the box and the query the shown results are for. */
export interface RunsSearch {
  value: string;
  /** The query of the results on screen (trimmed); empty when they are not filtered by text. */
  applied: string;
  onChange(value: string): void;
}

export interface RunsPageProps {
  slots: { used: number; total: number };
  today: string;
  filter: RunsFilter;
  counts: Record<RunsFilter, number>;
  onFilter?(f: RunsFilter): void;
  /** Whether the list is grouped by ticket; drives the toggle's pressed state. */
  grouped?: boolean;
  onGroupedChange?(grouped: boolean): void;
  /** The search box; without it (the Ignored view, which has nothing to search) no box is drawn. */
  search?: RunsSearch;
  /** When set, the chips are links to this href (e.g. `?filter=queued`) instead of buttons. */
  filterHref?(f: RunsFilter): string;
  /** Static banners above the page header. */
  banners?: ReactNode;
  children?: ReactNode;
}

const chips: { filter: RunsFilter; label: string }[] = [
  { filter: 'needs_you', label: 'Needs you' },
  { filter: 'active', label: 'Active' },
  { filter: 'queued', label: 'Queued' },
  { filter: 'ended', label: 'Ended' },
  { filter: 'all', label: 'All' },
];

/** The single <main> shared by the Runs boards: header, search, chips. */
export function RunsPage({
  slots,
  today,
  filter,
  counts,
  onFilter,
  grouped = true,
  onGroupedChange,
  search,
  filterHref,
  banners,
  children,
}: RunsPageProps) {
  const meta = (
    <span className={`muted ${styles.runsMeta}`}>
      <span className={styles.runsSlots}>
        <Icon name="play" size={12} />
        <span>
          Slots{' '}
          <b className={styles.slotNum}>
            {slots.used} of {slots.total}
          </b>{' '}
          in use
        </span>
      </span>
      <span>{today}</span>
    </span>
  );
  const tools = (
    <>
      {search && (
        <SearchInput
          placeholder="Ticket number or title"
          aria-label="Search runs"
          value={search.value}
          onChange={(e) => search.onChange(e.target.value)}
          onClear={() => search.onChange('')}
        />
      )}
      <Button icon="rule" aria-pressed={grouped} onClick={() => onGroupedChange?.(!grouped)}>
        Grouped by ticket
      </Button>
    </>
  );
  const chipRow = (
    <div className={styles.chipRow}>
      <FilterChips aria-label="Filter by status">
        {chips.map((c) => (
          <FilterChip
            key={c.filter}
            label={c.label}
            count={counts[c.filter]}
            icon={c.filter === 'needs_you' ? <StatusIcon status="idle" size={12} /> : undefined}
            on={filter === c.filter}
            onClick={() => onFilter?.(c.filter)}
            href={filterHref?.(c.filter)}
          />
        ))}
      </FilterChips>
      <FilterChip
        label="Ignored"
        count={counts.ignored}
        icon={<Icon name="ignored" size={13} />}
        on={filter === 'ignored'}
        onClick={() => onFilter?.('ignored')}
        href={filterHref?.('ignored')}
      />
    </div>
  );

  // The bar and the menu are the shell's: the page draws its header (title, facts, search and grouping, the setup
  // warnings), the chips and the list. There is no repository button; the repository is in the menu.
  return (
    <main className={styles.shellMain}>
      <PageHeader title="Runs" meta={meta} actions={tools} banner={banners} />
      {chipRow}
      {children}
    </main>
  );
}
