import { useId, type ReactNode } from 'react';
import { IconButton } from '@/ds';
import styles from './Composites.module.css';

export interface SidePaneProps {
  title: string;
  width?: number;
  onClose(): void;
  children: ReactNode;
  footer?: ReactNode;
}

export function SidePane({ title, width = 560, onClose, children, footer }: SidePaneProps) {
  const id = useId();
  return (
    <aside className={styles.pane} style={{ width }} aria-labelledby={id}>
      <div className={styles.paneHead}>
        <h2 id={id}>{title}</h2>
        <IconButton icon="x" aria-label="Close" onClick={onClose} />
      </div>
      {children}
      {footer && <div className={styles.paneFoot}>{footer}</div>}
    </aside>
  );
}
