import { useRef, type CSSProperties, type ReactNode } from 'react';
import { useFocusTrap } from './useFocusTrap';
import styles from './Overlay.module.css';

export interface PopoverProps {
  open: boolean;
  label: string;
  onClose?(): void;
  role?: 'dialog' | 'menu' | 'status';
  style?: CSSProperties;
  width?: number;
  children?: ReactNode;
}

/** Non-modal card positioned by the caller via `style`. */
export function Popover({ open, label, onClose, role = 'dialog', style, width, children }: PopoverProps) {
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
      className={styles.pop}
      role={role}
      aria-label={label}
      style={{ ...(width ? { width } : null), ...style }}
    >
      {children}
    </div>
  );
}
