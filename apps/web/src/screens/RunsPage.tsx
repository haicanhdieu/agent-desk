import type { ReactNode } from 'react';
import { Button, Icon, SearchInput, StatusIcon } from '@/ds';
import { FilterChip, FilterChips, TopBar, type TopBarProps } from '@/components';
import type { Actor, Project } from '@/mocks/types';
import styles from './Screens.module.css';

export type RunsFilter = 'needs_you' | 'active' | 'queued' | 'ended' | 'all' | 'ignored';

export interface RunsPageProps {
  project: Project;
  user: Actor;
  needsYou: number;
  slots: { used: number; total: number };
  today: string;
  filter: RunsFilter;
  counts: Record<RunsFilter, number>;
  onFilter?(f: RunsFilter): void;
  /** When set, the chips are links to this href (e.g. `?filter=queued`) instead of buttons. */
  filterHref?(f: RunsFilter): string;
  /** In-app hrefs for the top bar. */
  links?: TopBarProps['links'];
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

/** Top bar plus the single <main> shared by the Runs boards: header, search, chips. */
export function RunsPage({
  project, user, needsYou, slots, today, filter, counts, onFilter, filterHref, links, banners, children,
}: RunsPageProps) {
  return (
    <>
      <TopBar
        variant="project"
        active="runs"
        user={user}
        needsYou={needsYou}
        links={links}
        project={{ org: project.org, name: project.name, repoUrl: `https://github.com/${project.repo}` }}
      />
      <main className={`${styles.runsMain} ${banners ? styles.runsMainBanners : ''}`}>
        {banners}
        <div className={styles.runsHead}>
          <div className={styles.runsTitle}>
            <h1>Runs</h1>
            <span className={`muted ${styles.runsMeta}`}>
              <span className={styles.runsSlots}>
                <Icon name="play" size={12} />
                <span>Slots <b className={styles.slotNum}>{slots.used} of {slots.total}</b> in use</span>
              </span>
              <span>{today}</span>
            </span>
          </div>
          <div className={styles.runsTools}>
            <SearchInput placeholder="Ticket number or title" aria-label="Search runs" />
            <Button icon="rule" aria-pressed="true">Grouped by ticket</Button>
          </div>
        </div>
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
        {children}
      </main>
    </>
  );
}
