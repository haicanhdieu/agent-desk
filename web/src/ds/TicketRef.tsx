import { Icon } from './Icon';
import styles from './Chips.module.css';

export type TicketKind = 'issue' | 'pr';

export interface TicketRefProps {
  kind: TicketKind;
  number: number;
  short?: boolean;
}

export function TicketRef({ kind, number, short }: TicketRefProps) {
  const text = short ? `#${number}` : `${kind === 'pr' ? 'PR' : 'Issue'} #${number}`;
  return (
    <span className={styles.kind}>
      <Icon name={kind === 'pr' ? 'pull-request' : 'issue'} size={14} />
      <span className={styles.tref}>{text}</span>
    </span>
  );
}
