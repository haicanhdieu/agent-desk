import { useEffect, useRef, useState } from 'react';

/** Where the actions menu sits: under the More button, right edges aligned, in viewport coordinates. */
export interface MenuAt {
  top: number;
  right: number;
}

/**
 * Open/close state and placement for a row's More menu. Attach `moreRef` to the element wrapping the More button
 * and the Popover; place the Popover with `menuAt`.
 */
export function useRowMenu() {
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
    setMenuAt({ top: (r?.bottom ?? 0) + 4, right: window.innerWidth - (r?.right ?? 0) });
  };

  return { menuAt, open, moreRef, toggleMenu, closeMenu };
}
