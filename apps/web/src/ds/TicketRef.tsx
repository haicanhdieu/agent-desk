import { Icon } from './Icon';
import styles from './Chips.module.css';

export type TicketKind = 'issue' | 'pr';

export interface TicketRefProps {
  kind: TicketKind;
  number: number;
  short?: boolean;
  /** Absolute http(s) URL of the ticket. Empty or missing renders plain text, never a broken link. */
  href?: string;
}

export function TicketRef({ kind, number, short, href }: TicketRefProps) {
  const text = short ? `#${number}` : `${kind === 'pr' ? 'PR' : 'Issue'} #${number}`;
  const content = (
    <>
      <Icon name={kind === 'pr' ? 'pull-request' : 'issue'} size={14} />
      <span className={styles.tref}>{text}</span>
    </>
  );
  if (!href) return <span className={styles.kind}>{content}</span>;
  // External, so a plain anchor (not AppLink) that opens a new window without handing it window.opener.
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={`${styles.kind} ${styles.trefLink}`}>
      {content}
    </a>
  );
}
