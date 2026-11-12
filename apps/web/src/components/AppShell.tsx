import type { ReactNode } from 'react';
import styles from './Chrome.module.css';

export interface AppShellProps {
  height: number;
  topBar: ReactNode;
  children?: ReactNode;
}

export function AppShell({ height, topBar, children }: AppShellProps) {
  return (
    <div className={styles.app} style={{ height }}>
      {topBar}
      {children}
    </div>
  );
}
