import type { ReactNode } from 'react';
import styles from './Chrome.module.css';

export interface AppShellProps {
  /** Pixels (the boards), or `'viewport'` to fill the window: the top bar stays put and the content scrolls inside. */
  height: number | 'viewport';
  topBar: ReactNode;
  children?: ReactNode;
}

export function AppShell({ height, topBar, children }: AppShellProps) {
  const fill = height === 'viewport';
  return (
    <div className={fill ? `${styles.app} ${styles.appViewport}` : styles.app} style={fill ? undefined : { height }}>
      {topBar}
      {children}
    </div>
  );
}
