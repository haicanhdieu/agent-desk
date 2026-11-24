import { useEffect, type KeyboardEvent, type RefObject } from 'react';

const MENU_ITEMS = 'a[href],button:not([disabled])';
const ARROW_KEYS = ['ArrowDown', 'ArrowUp', 'Home', 'End'];

/**
 * Keyboard and pointer behaviour shared by the popover menus: an outside press closes the menu, ArrowDown on the
 * trigger opens it, and arrow keys, Home and End move between the menu items. Escape and focus return stay with the Popover.
 */
export function useMenuNav(open: boolean, setOpen: (open: boolean) => void, wrapRef: RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (e: PointerEvent) => {
      if (e.target instanceof Node && !wrapRef.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open, setOpen, wrapRef]);

  const onTriggerKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === 'ArrowDown' && !open) {
      e.preventDefault();
      setOpen(true);
    }
  };

  const onMenuKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (!ARROW_KEYS.includes(e.key)) return;
    const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>(MENU_ITEMS));
    if (items.length === 0) return;
    e.preventDefault();
    const at = items.findIndex((el) => el === document.activeElement);
    let next = 0;
    if (e.key === 'End') next = items.length - 1;
    else if (e.key === 'ArrowDown') next = (at + 1) % items.length;
    else if (e.key === 'ArrowUp') next = (at <= 0 ? items.length : at) - 1;
    items[next]?.focus();
  };

  return { onTriggerKeyDown, onMenuKeyDown };
}
