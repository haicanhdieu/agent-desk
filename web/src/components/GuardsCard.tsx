import { useId } from 'react';
import { Icon } from '@/ds';
import styles from './Composites.module.css';

export interface GuardsCardProps {
  maxRunsPerTicket: number;
  changeHref?: string;
  ignoredHref?: string;
}

export function GuardsCard({ maxRunsPerTicket, changeHref, ignoredHref }: GuardsCardProps) {
  const titleId = useId();
  return (
    <section className={styles.card} aria-labelledby={titleId}>
      <h2 id={titleId} className={`h3 ${styles.cardTitle}`}><Icon name="lock" size={16} />Guards on every rule</h2>
      <ul className={styles.guards}>
        <li><span className={styles.strong}>Who can trigger:</span> repo owners, members and collaborators, and <span className={styles.monoText}>agent-desk[bot]</span>. Anyone else is ignored.</li>
        <li>
          <span className={styles.strong}>Runs per ticket:</span> at most <b>{maxRunsPerTicket}</b>.{' '}
          {changeHref && <a href={changeHref}>Change</a>}
        </li>
        <li><span className={styles.strong}>One at a time:</span> a ticket can have only one active run per skill.</li>
        <li>
          Ignored commands are listed under {ignoredHref ? <a href={ignoredHref}>Runs, Ignored</a> : 'Runs, Ignored'} with the reason.
        </li>
      </ul>
    </section>
  );
}
