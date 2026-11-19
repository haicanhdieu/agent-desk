import { useEffect, useRef } from 'react';
import { Button, IconButton, SearchInput } from '@/ds';
import styles from './Terminal.module.css';

export interface TerminalFindBarProps {
  query: string;
  /** How many matches the query has in the log. */
  total: number;
  /** 0-based index of the match in focus. */
  current: number;
  onQueryChange(query: string): void;
  onNext(): void;
  onPrev(): void;
  onClose(): void;
}

/** The find row under a terminal bar: a search box, "n of m", previous / next and close. Enter steps, Escape closes. */
export function TerminalFindBar({
  query,
  total,
  current,
  onQueryChange,
  onNext,
  onPrev,
  onClose,
}: TerminalFindBarProps) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector('input')?.focus();
  }, []);
  const status = query === '' ? '' : total === 0 ? 'No matches' : `${current + 1} of ${total}`;
  return (
    <div
      ref={ref}
      className={styles.findbar}
      role="search"
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
        else if (e.key === 'Enter') {
          e.preventDefault();
          if (e.shiftKey) onPrev();
          else onNext();
        }
      }}
    >
      <SearchInput
        placeholder="Find in log"
        aria-label="Find in log"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
      />
      <span className={styles.findCount} role="status">
        {status}
      </span>
      <Button variant="ghost" size="sm" disabled={total === 0} onClick={onPrev} aria-label="Previous match">
        Prev
      </Button>
      <Button variant="ghost" size="sm" disabled={total === 0} onClick={onNext} aria-label="Next match">
        Next
      </Button>
      <IconButton icon="x" size="sm" aria-label="Close find" onClick={onClose} />
    </div>
  );
}
