import { useEffect, useRef, type RefObject } from 'react';

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

export interface FocusTrapOptions {
  active: boolean;
  /** Return focus to the previously focused element when deactivated. */
  restoreFocus?: boolean;
  /** Move focus to the first focusable element on activation (default true). */
  focusOnOpen?: boolean;
  /** Wrap Tab / Shift+Tab inside the container (modal). Default true. */
  trap?: boolean;
  onEscape?: () => void;
}

const focusables = (root: HTMLElement) =>
  Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE));

/** Manual focus management shared by Dialog (modal) and Popover (non-modal). */
export function useFocusTrap(ref: RefObject<HTMLElement | null>, opts: FocusTrapOptions) {
  const { active, restoreFocus = true, focusOnOpen = true, trap = true } = opts;
  const escRef = useRef(opts.onEscape);
  const { onEscape } = opts;
  useEffect(() => {
    escRef.current = onEscape;
  }, [onEscape]);

  useEffect(() => {
    const root = ref.current;
    if (!active || !root) return undefined;
    const opener = document.activeElement as HTMLElement | null;

    if (focusOnOpen) {
      const first = focusables(root)[0];
      if (first) first.focus();
      else {
        root.tabIndex = -1;
        root.focus();
      }
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        escRef.current?.();
        return;
      }
      if (e.key !== 'Tab' || !trap) return;
      const items = focusables(root);
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const current = document.activeElement;
      if (e.shiftKey && (current === first || !root.contains(current))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (current === last || !root.contains(current))) {
        e.preventDefault();
        first.focus();
      }
    };
    root.addEventListener('keydown', onKeyDown);

    return () => {
      root.removeEventListener('keydown', onKeyDown);
      if (restoreFocus && opener && opener.isConnected) opener.focus();
    };
  }, [active, ref, restoreFocus, focusOnOpen, trap]);
}
