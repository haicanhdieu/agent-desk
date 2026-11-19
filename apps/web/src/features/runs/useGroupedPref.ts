import { useCallback, useState } from 'react';

/** Where the Runs page keeps the "Grouped by ticket" choice, per browser (not per org or project). */
export const GROUPED_STORAGE_KEY = 'agentdesk.runs.grouped';

/** Grouped unless the person turned it off; a missing, unreadable or unexpected value means grouped. */
function readGrouped(): boolean {
  try {
    return localStorage.getItem(GROUPED_STORAGE_KEY) !== 'false';
  } catch {
    return true;
  }
}

/**
 * The Runs page's "Grouped by ticket" state, restored from localStorage on mount and saved on every change.
 * Storage can be blocked or full (private windows, site data off): the toggle then still works for this visit.
 */
export function useGroupedPref(): [boolean, (grouped: boolean) => void] {
  const [grouped, setGroupedState] = useState(readGrouped);
  const setGrouped = useCallback((next: boolean) => {
    setGroupedState(next);
    try {
      localStorage.setItem(GROUPED_STORAGE_KEY, String(next));
    } catch {
      // Not saved; the choice still applies until the page closes.
    }
  }, []);
  return [grouped, setGrouped];
}
