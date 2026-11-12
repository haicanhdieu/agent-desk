import { useId, type ReactNode } from 'react';
import styles from './Composites.module.css';

export function SettingsSection({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  const id = useId();
  return (
    <section className={styles.settings} aria-labelledby={id}>
      <div className={styles.settingsHead}>
        <h2 id={id}>{title}</h2>
        {description && <p className={styles.settingsDesc}>{description}</p>}
      </div>
      <div className={styles.settingsBody}>{children}</div>
    </section>
  );
}
