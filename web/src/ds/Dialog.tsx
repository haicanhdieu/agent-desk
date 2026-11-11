import { useId, useRef, type ReactNode } from 'react';
import { useFocusTrap } from './useFocusTrap';
import styles from './Overlay.module.css';

export interface DialogProps {
  open: boolean;
  title: ReactNode;
  onClose(): void;
  children?: ReactNode;
  footer?: ReactNode;
  width?: number;
}

/** Modal dialog. The scrim is absolutely positioned in the nearest positioned ancestor (not portalled). */
export function Dialog({ open, title, onClose, children, footer, width = 520 }: DialogProps) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useFocusTrap(ref, { active: open, restoreFocus: true, trap: true, onEscape: onClose });
  if (!open) return null;
  return (
    <div className={styles.overlay}>
      <div
        ref={ref}
        className={styles.dialog}
        style={{ width }}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className={styles['d-b']}>
          <h2 id={titleId}>{title}</h2>
          {children}
        </div>
        {footer && <div className={styles['d-f']}>{footer}</div>}
      </div>
    </div>
  );
}
