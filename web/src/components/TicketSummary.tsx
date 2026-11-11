import { Icon, LabelChip, TicketRef } from '@/ds';
import type { Ticket } from '../mocks/types';
import styles from './SidePanel.module.css';

export function TicketSummary({ ticket, diffstat }: { ticket: Ticket; diffstat?: string }) {
  return (
    <div className={styles.tsBody}>
      <div className={styles.tsTop}>
        <TicketRef kind={ticket.kind} number={ticket.number} />
        <a className={styles.tsLink} href={ticket.href}>Open in GitHub<Icon name="external" size={12} /></a>
      </div>
      <div className={styles.tsTitle}>{ticket.title}</div>
      <div className={styles.tsMeta}>
        {ticket.labels.map((l) => <LabelChip key={l.name} name={l.name} color={l.color} />)}
        {ticket.state && <span className={styles.tsState}>{ticket.state}</span>}
        {diffstat && <span className="num faint">{diffstat}</span>}
      </div>
    </div>
  );
}
