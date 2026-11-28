import { useRef, type ReactNode } from 'react';
import { useFocusTrap } from './useFocusTrap';
import styles from './Drawer.module.css';

export interface DrawerProps {
  open: boolean;
  /** Accessible name of the drawer. */
  label: string;
  onClose(): void;
  children: ReactNode;
}

/** Modal side panel (280px) over a scrim, for the menu below 1024px. Not portalled. */
export function Drawer({ open, label, onClose, children }: DrawerProps) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref, { active: open, restoreFocus: true, trap: true, onEscape: onClose });
  if (!open) return null;
  return (
    <div className={styles.root}>
      <div className={styles.scrim} data-testid="drawer-scrim" onClick={onClose} />
      <div ref={ref} className={styles.panel} role="dialog" aria-modal="true" aria-label={label}>
        {children}
      </div>
    </div>
  );
}
