/**
 * How long a run's terminal page may go unused before the browser closes its socket, so a forgotten tab stops renewing
 * its attach lease and the run can pause (decision D2). One constant; the page text derives its hours from it.
 */
export const TERMINAL_UNUSED_CLOSE_MS = 4 * 60 * 60 * 1000;

/** DOM events that count as a person using the page. xterm's automatic replies are not DOM events and do not count. */
const USE_EVENTS = ['keydown', 'pointerdown', 'wheel', 'touchstart'] as const;

/**
 * Calls `onUnused` once when the page has gone `ms` without use: either no use event (keydown, pointerdown, wheel,
 * touchstart) for `ms`, or the tab continuously hidden (`document.visibilityState === 'hidden'`) for `ms`. The clock
 * decides, not a timer count, so a throttled or sleeping page fires as soon as its timer runs. Returns a function that
 * stops watching (listeners and timer); calling it again, or after `onUnused` fired, does nothing.
 */
export function watchUnused(ms: number, onUnused: () => void): () => void {
  let lastUse = Date.now();
  let hiddenSince: number | undefined = document.visibilityState === 'hidden' ? lastUse : undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const stop = () => {
    clearTimeout(timer);
    timer = undefined;
    for (const type of USE_EVENTS) document.removeEventListener(type, onUse, true);
    document.removeEventListener('visibilitychange', onVisibility);
  };

  // Events only ever move a deadline later, so one timer armed for the earliest deadline is re-armed when it runs.
  const check = () => {
    const now = Date.now();
    const idleLeft = lastUse + ms - now;
    const hiddenLeft = hiddenSince === undefined ? Infinity : hiddenSince + ms - now;
    const left = Math.min(idleLeft, hiddenLeft);
    if (left <= 0) {
      stop();
      onUnused();
      return;
    }
    timer = setTimeout(check, left);
  };

  function onUse() {
    lastUse = Date.now();
  }
  function onVisibility() {
    hiddenSince = document.visibilityState === 'hidden' ? Date.now() : undefined;
  }

  for (const type of USE_EVENTS) document.addEventListener(type, onUse, { capture: true, passive: true });
  document.addEventListener('visibilitychange', onVisibility);
  check();
  return stop;
}
