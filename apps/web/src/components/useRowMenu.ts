import { useEffect, useRef, useState } from 'react';

/** Where the actions menu sits: under the More button, right edges aligned, in viewport coordinates. */
export interface MenuAt {
  /** Set when the menu opens downward. */
  top?: number;
  /** Set instead of `top` when the menu opens upward (it would not fit under the button). */
  bottom?: number;
  right: number;
}

/**
 * Open/close state and placement for a row's More menu. Attach `moreRef` to the element wrapping the More button
 * and the Popover; place the Popover with `menuAt`. With `menuHeight` (px), a menu that would run off the bottom of
 * the viewport opens upward instead, when there is room above.
 */
export function useRowMenu(menuHeight?: number) {
  const [menuAt, setMenuAt] = useState<MenuAt | null>(null);
  const moreRef = useRef<HTMLSpanElement>(null);
  const open = menuAt !== null;

  // An outside press, a scroll or a resize closes the menu (it is placed in viewport coordinates, so it would drift).
  // Escape is handled by the Popover, which also returns focus to the More button.
  useEffect(() => {
    if (!open) return undefined;
    const close = () => setMenuAt(null);
    const onPointerDown = (e: PointerEvent) => {
      if (e.target instanceof Node && !moreRef.current?.contains(e.target)) close();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  const closeMenu = () => setMenuAt(null);
  const toggleMenu = () => {
    if (open) {
      setMenuAt(null);
      return;
    }
    const r = moreRef.current?.getBoundingClientRect();
    const right = window.innerWidth - (r?.right ?? 0);
    const below = (r?.bottom ?? 0) + 4;
    const flip =
      r !== undefined &&
      menuHeight !== undefined &&
      below + menuHeight > window.innerHeight &&
      r.top - 4 - menuHeight >= 0;
    setMenuAt(flip ? { bottom: window.innerHeight - r.top + 4, right } : { top: below, right });
  };

  return { menuAt, open, moreRef, toggleMenu, closeMenu };
}
