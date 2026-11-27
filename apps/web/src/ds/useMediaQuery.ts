import { useCallback, useSyncExternalStore } from 'react';

/** Below this width the side menu is a drawer. */
export const BELOW_DESKTOP = '(max-width: 1023px)';
/** Phone layout. */
export const PHONE = '(max-width: 639px)';

/** Whether a CSS media query matches now, and re-renders when that changes. */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (notify: () => void) => {
      const list = window.matchMedia(query);
      list.addEventListener('change', notify);
      return () => list.removeEventListener('change', notify);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}
