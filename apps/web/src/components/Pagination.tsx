import { useId, useState, type FormEvent } from 'react';
import { Button, Select, TextInput } from '@/ds';
import styles from './Pagination.module.css';

export const PAGE_SIZE_OPTIONS = [20, 50, 100] as const;
export type PageSizeOption = (typeof PAGE_SIZE_OPTIONS)[number];

export interface PaginationProps {
  page: number;
  pageSize: PageSizeOption;
  total: number;
  /** The next page is loading: nav aria-busy, every control disabled. */
  busy?: boolean;
  /** Accessible name of the nav. Only a page with several controls (the Board story) needs another one. */
  label?: string;
  onPageChange(page: number): void;
  onPageSizeChange(size: PageSizeOption): void;
}

/** 'wide': first, last, current ± 1; 'narrow': first, current, last. 'gap' between non-adjacent numbers. */
export function pageItems(page: number, pageCount: number, set: 'wide' | 'narrow'): (number | 'gap')[] {
  const near = set === 'wide' ? [page - 1, page, page + 1] : [page];
  const numbers = [...new Set([1, pageCount, ...near])].filter((n) => n >= 1 && n <= pageCount).sort((a, b) => a - b);
  const items: (number | 'gap')[] = [];
  numbers.forEach((n, i) => {
    if (i > 0 && n - numbers[i - 1] > 1) items.push('gap');
    items.push(n);
  });
  return items;
}

const countFormat = new Intl.NumberFormat('en-US');

/** 12480 → "12,480" (en-US grouping). */
export function formatCount(n: number): string {
  return countFormat.format(n);
}

function pageSizeOf(value: string): PageSizeOption | undefined {
  return PAGE_SIZE_OPTIONS.find((o) => String(o) === value);
}

interface PageListProps {
  items: (number | 'gap')[];
  page: number;
  busy: boolean;
  className: string;
  onPageChange(page: number): void;
}

function PageList({ items, page, busy, className, onPageChange }: PageListProps) {
  return (
    <ol className={className}>
      {items.map((item, i) =>
        item === 'gap' ? (
          <li key={`gap-${i}`} className={styles.gap} aria-hidden="true">
            …
          </li>
        ) : (
          <li key={item}>
            <Button
              variant={item === page ? 'default' : 'ghost'}
              className={styles.num}
              aria-label={`Page ${item}`}
              aria-current={item === page ? 'page' : undefined}
              disabled={busy}
              onClick={() => onPageChange(item)}
            >
              {item}
            </Button>
          </li>
        ),
      )}
    </ol>
  );
}

/** Offset pagination under a data list. Not rendered when everything fits on the first page. */
export function Pagination({
  page,
  pageSize,
  total,
  busy = false,
  label = 'Pagination',
  onPageChange,
  onPageSizeChange,
}: PaginationProps) {
  const ids = useId();
  const [jump, setJump] = useState('');
  if (total <= PAGE_SIZE_OPTIONS[0]) return null;

  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const first = (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);
  const target = /^-?\d+$/.test(jump) ? Number(jump) : undefined;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (busy || target === undefined) return;
    onPageChange(Math.min(pageCount, Math.max(1, target)));
    setJump('');
  };

  return (
    <nav aria-label={label} aria-busy={busy} className={styles.nav}>
      <div className={styles.row}>
        <p className={styles.range}>
          {first <= last && (
            <>
              <span className={styles.word}>Showing </span>
              <span className={styles.value}>
                {formatCount(first)}–{formatCount(last)}
              </span>{' '}
              of <span className={styles.value}>{formatCount(total)}</span>
            </>
          )}
        </p>
        <div className={styles.pages}>
          <Button
            variant="ghost"
            icon="chevron-left"
            className={styles.step}
            disabled={busy || page <= 1}
            onClick={() => onPageChange(page - 1)}
          >
            <span className={styles.stepText}>Previous</span>
          </Button>
          <PageList
            items={pageItems(page, pageCount, 'wide')}
            page={page}
            busy={busy}
            className={`${styles.slots} ${styles.wide}`}
            onPageChange={onPageChange}
          />
          <PageList
            items={pageItems(page, pageCount, 'narrow')}
            page={page}
            busy={busy}
            className={`${styles.slots} ${styles.narrow}`}
            onPageChange={onPageChange}
          />
          <span className={styles.only} aria-current="page">
            <span className={styles.srOnly}>Page </span>
            {formatCount(page)}
          </span>
          <Button
            variant="ghost"
            iconRight="chevron-right"
            className={styles.step}
            disabled={busy || page >= pageCount}
            onClick={() => onPageChange(page + 1)}
          >
            <span className={styles.stepText}>Next</span>
          </Button>
        </div>
        <div className={styles.tools}>
          <form className={styles.field} onSubmit={submit}>
            <label htmlFor={`${ids}-jump`} className={styles.label}>
              Go to page
            </label>
            <TextInput
              id={`${ids}-jump`}
              numeric
              inputMode="numeric"
              autoComplete="off"
              className={styles.jump}
              value={jump}
              disabled={busy}
              onChange={(e) => {
                if (/^-?\d*$/.test(e.target.value)) setJump(e.target.value);
              }}
            />
            <Button type="submit" className={styles.go} disabled={busy || target === undefined}>
              Go
            </Button>
          </form>
          <div className={styles.field}>
            <label htmlFor={`${ids}-size`} className={styles.label}>
              Rows per page
            </label>
            <Select
              id={`${ids}-size`}
              className={styles.size}
              mono
              value={String(pageSize)}
              disabled={busy}
              onChange={(e) => {
                const size = pageSizeOf(e.target.value);
                if (size) onPageSizeChange(size);
              }}
            >
              {PAGE_SIZE_OPTIONS.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </Select>
          </div>
        </div>
      </div>
    </nav>
  );
}
