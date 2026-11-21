import type { ExpiryView } from '@/mocks/types';
import styles from './Invitations.module.css';

/** The Expires cell: a relative label with the exact date on hover (and for screen readers), the exact date, or a dash. */
export function ExpiryLabel({ expires }: { expires: ExpiryView }) {
  if (expires.kind === 'none') return <span className={styles.muted}>{expires.text}</span>;
  if (expires.kind === 'exact') {
    return (
      <time className={styles.muted} dateTime={expires.dateTime} title={expires.title ?? expires.text}>
        {expires.text}
      </time>
    );
  }
  return (
    <>
      <time className={styles.muted} dateTime={expires.dateTime} title={expires.title}>
        {expires.text}
      </time>
      {expires.title && <span className="sr-only">{expires.title}</span>}
    </>
  );
}
