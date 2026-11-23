import type { OrgStatusView } from '@/mocks/platform/orgs';
import styles from './OrgStatus.module.css';

const label: Record<OrgStatusView, string> = { active: 'Active', suspended: 'Suspended' };

/** Org state as a glyph plus text: a check disc for Active, a pause disc for Suspended (shape, not only colour). */
export function OrgStatus({ status }: { status: OrgStatusView }) {
  return (
    <span className={`${styles.status} ${status === 'active' ? styles.active : styles.suspended}`}>
      <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
        <circle cx="8" cy="8" r="7" fill="currentColor" />
        {status === 'active' ? (
          <path
            d="M4.8 8.2l2.2 2.2 4.2-4.6"
            fill="none"
            stroke="var(--on-ok)"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ) : (
          <>
            <rect x="5.4" y="4.6" width="1.8" height="6.8" rx=".6" fill="var(--on-late)" />
            <rect x="8.8" y="4.6" width="1.8" height="6.8" rx=".6" fill="var(--on-late)" />
          </>
        )}
      </svg>
      <span className={styles.text}>{label[status]}</span>
    </span>
  );
}
