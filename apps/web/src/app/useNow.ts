import { useSyncExternalStore } from 'react';

const TICK_MS = 30_000;

// One shared clock for every relative time on the page: a single interval runs while anything is subscribed, and
// all subscribers see the same Date instance between ticks.
let now = new Date();
let timer: ReturnType<typeof setInterval> | undefined;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  if (listeners.size === 0) {
    now = new Date();
    timer = setInterval(() => {
      now = new Date();
      for (const l of listeners) l();
    }, TICK_MS);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      clearInterval(timer);
      timer = undefined;
    }
  };
}

const getSnapshot = () => now;

/** The current time, re-rendering every 30 s so "3 min ago" stays true for cached data. */
export function useNow(): Date {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
