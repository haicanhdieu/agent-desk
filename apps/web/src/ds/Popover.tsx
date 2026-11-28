import { useRef, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { useFocusTrap } from './useFocusTrap';
import styles from './Overlay.module.css';

export interface PopoverProps {
  open: boolean;
  label: string;
  /** Id of the popover element, for a trigger's `aria-controls`. */
  id?: string;
  onClose?(): void;
  /** Key presses inside the popover, including those while its own root holds focus (nothing to focus yet). */
  onKeyDown?(e: KeyboardEvent<HTMLDivElement>): void;
  role?: 'dialog' | 'menu' | 'status';
  style?: CSSProperties;
  width?: number;
  children?: ReactNode;
}

/** Non-modal card positioned by the caller via `style`. */
export function Popover({
  open,
  label,
  id,
  onClose,
  onKeyDown,
  role = 'dialog',
  style,
  width,
  children,
}: PopoverProps) {
  const ref = useRef<HTMLDivElement>(null);
  const managesFocus = role !== 'status';
  useFocusTrap(ref, {
    active: open && managesFocus,
    restoreFocus: true,
    trap: false,
    onEscape: onClose,
  });
  if (!open) return null;
  return (
    <div
      ref={ref}
      id={id}
      className={styles.pop}
      role={role}
      aria-label={label}
      onKeyDown={onKeyDown}
      style={{ ...(width ? { width } : null), ...style }}
    >
      {children}
    </div>
  );
}
