import type { KeyboardEvent } from 'react';

const ARROW_KEYS = ['ArrowDown', 'ArrowUp', 'Home', 'End'];

/**
 * Arrow-key navigation for a popover menu: ArrowDown and ArrowUp move focus among the elements matching `itemSelector`
 * (wrapping), Home and End jump to the first and last. Put it on the element that contains the items.
 */
export function menuKeyDown(itemSelector: string) {
  return (e: KeyboardEvent<HTMLElement>) => {
    if (!ARROW_KEYS.includes(e.key)) return;
    const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>(itemSelector));
    if (items.length === 0) return;
    e.preventDefault();
    const at = items.findIndex((el) => el === document.activeElement);
    let next = 0;
    if (e.key === 'End') next = items.length - 1;
    else if (e.key === 'ArrowDown') next = (at + 1) % items.length;
    else if (e.key === 'ArrowUp') next = (at <= 0 ? items.length : at) - 1;
    items[next]?.focus();
  };
}
