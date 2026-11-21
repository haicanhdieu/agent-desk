import { Icon } from './Icon';
import { prStateTokens, type PrState } from './tokens';
import styles from './Chips.module.css';

export type TicketKind = 'issue' | 'pr';

const prStateClass: Record<PrState, string> = {
  open: styles.prOpen,
  draft: styles.prDraft,
  merged: styles.prMerged,
  closed: styles.prClosed,
};

export interface TicketIconProps {
  kind: TicketKind;
  /** Live PR state. Used only for a PR; missing or unknown stays neutral. */
  prState?: PrState;
  size?: number;
}

export function TicketIcon({ kind, prState, size = 14 }: TicketIconProps) {
  if (kind !== 'pr') return <Icon name="issue" size={size} />;
  if (!prState) return <Icon name="pull-request" size={size} />;
  const { label } = prStateTokens[prState];
  return (
    <span className={`${styles.prIcon} ${prStateClass[prState]}`} title={label}>
      <Icon name="pull-request" size={size} aria-label={label} />
    </span>
  );
}

export interface TicketRefProps {
  kind: TicketKind;
  number: number;
  short?: boolean;
  /** Absolute http(s) URL of the ticket. Empty or missing renders plain text, never a broken link. */
  href?: string;
  /** Live PR state; colours the glyph only. Ignored for an issue. */
  prState?: PrState;
}

export function TicketRef({ kind, number, short, href, prState }: TicketRefProps) {
  const text = short ? `#${number}` : `${kind === 'pr' ? 'PR' : 'Issue'} #${number}`;
  const content = (
    <>
      <TicketIcon kind={kind} prState={prState} />
      {/* A flex container drops this space visually; it keeps the accessible name "Merged PR #148". */}{' '}
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
