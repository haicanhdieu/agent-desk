import { useEffect, useRef, useState } from 'react';

/** How long typing must pause before the list is asked for. */
export const SEARCH_DEBOUNCE_MS = 300;

/**
 * A search box over a query that lives in the URL. The box shows what was typed at once; `commit` gets the trimmed
 * text after a pause in typing (or at once when the box is emptied or cleared). A change of `committed` that did
 * not come from typing (back/forward, a shared link) is shown in the box.
 */
export function useSearchBox(
  committed: string | undefined,
  commit: (q: string | undefined) => void,
  delay: number = SEARCH_DEBOUNCE_MS,
): { value: string; onChange(value: string): void } {
  const [value, setValue] = useState(committed ?? '');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // The latest commit, so a pending timer never calls a stale route callback.
  const latest = useRef(commit);
  useEffect(() => {
    latest.current = commit;
  });
  useEffect(() => {
    if (timer.current === undefined)
      setValue((typed) => (typed.trim() === (committed ?? '') ? typed : (committed ?? '')));
  }, [committed]);
  useEffect(() => () => clearTimeout(timer.current), []);

  const onChange = (next: string) => {
    setValue(next);
    clearTimeout(timer.current);
    const text = next.trim();
    if (text === '') {
      timer.current = undefined;
      if ((committed ?? '') !== '') latest.current(undefined);
      return;
    }
    timer.current = setTimeout(() => {
      timer.current = undefined;
      latest.current(text);
    }, delay);
  };
  return { value, onChange };
}
