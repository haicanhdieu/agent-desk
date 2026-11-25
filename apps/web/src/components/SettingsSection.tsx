import { useId, type ReactNode } from 'react';
import styles from './Composites.module.css';

export function SettingsSection({
  title,
  description,
  badge,
  nested = false,
  children,
}: {
  title: string;
  description?: string;
  /** A chip beside the title, outside the heading text (e.g. "Project-wide"). */
  badge?: ReactNode;
  /** Sits inside a named region of its own (a tab's scroll box): not a second landmark with the same name. */
  nested?: boolean;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <section className={styles.settings} aria-labelledby={nested ? undefined : id}>
      <div className={styles.settingsHead}>
        {badge ? (
          <div className={styles.settingsTitleRow}>
            <h2 id={id}>{title}</h2>
            {badge}
          </div>
        ) : (
          <h2 id={id}>{title}</h2>
        )}
        {description && <p className={styles.settingsDesc}>{description}</p>}
      </div>
      <div className={styles.settingsBody}>{children}</div>
    </section>
  );
}
