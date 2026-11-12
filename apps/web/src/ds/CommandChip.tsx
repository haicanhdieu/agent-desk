import type { ReactNode } from 'react';
import styles from './Chips.module.css';

export function CommandChip({ children }: { children: ReactNode }) {
  return <code className={styles.cmd}>{children}</code>;
}
