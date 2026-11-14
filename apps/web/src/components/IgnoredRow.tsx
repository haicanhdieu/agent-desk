import { Button, CommandChip, TicketRef } from '@/ds';
import type { IgnoredCommand } from '@/mocks/types';
import styles from './RunList.module.css';

/** One row of the "Ignored commands" table. */
export function IgnoredRow({ item }: { item: IgnoredCommand }) {
  const ref = `${item.ticket.kind === 'pr' ? 'PR' : 'Issue'} #${item.ticket.number}`;
  return (
    <tr>
      <td className={`${styles.num} ${styles.muted}`}>{item.at}</td>
      <td>
        <TicketRef kind={item.ticket.kind} number={item.ticket.number} />
      </td>
      <td>
        <CommandChip>{item.command}</CommandChip>
      </td>
      <td className={styles.actor}>{item.author}</td>
      <td>
        <b className={styles.reason}>{item.reason}</b>
        <div className={styles.detail}>{item.detail}</div>
      </td>
      <td className={styles.actions}>
        <Button variant="ghost" size="sm" icon="external" href={item.href} aria-label={`Comment on ${ref}`}>
          Comment
        </Button>
      </td>
    </tr>
  );
}
