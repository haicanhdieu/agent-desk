import { useCallback, useSyncExternalStore } from 'react';

/**
 * The height of the part of the page the person can see (`window.visualViewport`), which shrinks when a phone's
 * on-screen keyboard opens; undefined where the browser has none. The phone run page sizes itself to it so the
 * keyboard does not cover the key row or the input line (BR-60).
 */
export function useVisualViewportHeight(enabled = true): number | undefined {
  // Off (a wide screen, which ignores the height): no listener, so a viewport resize never re-renders the caller.
  const subscribe = useCallback(
    (notify: () => void) => {
      const viewport = enabled ? window.visualViewport : undefined;
      viewport?.addEventListener('resize', notify);
      return () => viewport?.removeEventListener('resize', notify);
    },
    [enabled],
  );
  return useSyncExternalStore(
    subscribe,
    () => {
      const height = window.visualViewport?.height;
      return height === undefined ? undefined : Math.round(height);
    },
    () => undefined,
  );
}
