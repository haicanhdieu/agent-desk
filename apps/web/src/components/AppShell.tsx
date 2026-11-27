import type { ReactNode } from 'react';
import { BELOW_DESKTOP, Drawer, useMediaQuery } from '@/ds';
import styles from './Chrome.module.css';

export type MenuMode = 'full' | 'collapsed' | 'drawer' | 'wizard' | 'none';

export interface AppShellProps {
  /** Pixels (the boards), `'viewport'` to fill the window (the page inside decides what scrolls), absent: the window scrolls. */
  height?: number | 'viewport';
  topBar: ReactNode;
  /** One copy: inline, or inside the drawer when `menuMode` is 'drawer'. */
  menu?: ReactNode;
  menuMode?: MenuMode;
  drawerOpen?: boolean;
  onDrawerClose?(): void;
  /** The wizard's steps menu goes into this element: inline on a desktop window, inside the open drawer below it. */
  wizardSlotRef?(el: HTMLElement | null): void;
  children: ReactNode;
}

/**
 * The fixed tree: the top bar, then the body (inline menu slot, content slot), then the drawer as a sibling. The
 * content slot keeps its place in every menu mode, so the page inside is never remounted by a menu change.
 */
export function AppShell({
  height,
  topBar,
  menu,
  menuMode = 'none',
  drawerOpen = false,
  onDrawerClose,
  wizardSlotRef,
  children,
}: AppShellProps) {
  const below = useMediaQuery(BELOW_DESKTOP);
  const viewport = height === 'viewport';
  const wizard = menuMode === 'wizard';
  const inDrawer = menuMode === 'drawer' || (wizard && below);
  const inline = menuMode === 'none' ? false : !inDrawer;
  const slot = wizard ? (
    <div ref={wizardSlotRef} className={styles.wizardSlot}>
      {menu}
    </div>
  ) : (
    menu
  );
  const rootClass = viewport
    ? `${styles.app} ${styles.appViewport}`
    : typeof height === 'number'
      ? `${styles.app} ${styles.appFixed}`
      : styles.app;
  return (
    <div className={rootClass} style={typeof height === 'number' ? { height } : undefined}>
      {topBar}
      <div className={styles.body}>
        {inline && <div className={styles.menuSlot}>{slot}</div>}
        <div data-slot="content" className={viewport ? `${styles.content} ${styles.contentFill}` : styles.content}>
          {children}
        </div>
      </div>
      {inDrawer && (
        <Drawer open={drawerOpen} label="Main menu" onClose={onDrawerClose ?? noop}>
          {slot}
        </Drawer>
      )}
    </div>
  );
}

function noop() {}
