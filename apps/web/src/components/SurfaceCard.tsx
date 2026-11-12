import type { ReactNode } from 'react';
import styles from './Composites.module.css';

export function SurfaceCard({ caption, children }: { caption: ReactNode; children: ReactNode }) {
  return (
    <figure className={styles.surface}>
      <div className={styles.surfaceBody}>{children}</div>
      <figcaption className={styles.surfaceCap}>{caption}</figcaption>
    </figure>
  );
}
