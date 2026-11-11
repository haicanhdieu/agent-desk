import type { ReactNode } from 'react';
import styles from './SidePanel.module.css';

export interface SectionProps { title: string; aside?: ReactNode; children: ReactNode }

export function Section({ title, aside, children }: SectionProps) {
  return (
    <section className={styles.sec}>
      <div className={styles['sec-h']}><span>{title}</span>{aside}</div>
      {children}
    </section>
  );
}
