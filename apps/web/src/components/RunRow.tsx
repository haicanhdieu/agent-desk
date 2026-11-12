import type { ReactNode } from 'react';
import { AppLink, Avatar, Icon, LabelChip, StatusBadge, TicketRef } from '@/ds';
import type { RunSummary, TicketGroup } from '@/mocks/types';
import styles from './RunList.module.css';

const initialsOf = (login: string) =>
  login.split(/[-_.\s]+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join('');

export function TicketGroupRow({ group, colSpan }: { group: TicketGroup; colSpan: number }) {
  const { ticket } = group;
  return (
    <tr className={styles.grp}>
      <td colSpan={colSpan}>
        <div className={styles.grpRow}>
          <TicketRef kind={ticket.kind} number={ticket.number} />
          <b className={styles.grpTitle} title={ticket.title}>{ticket.title}</b>
          {ticket.labels.map((l) => <LabelChip key={l.name} name={l.name} color={l.color} />)}
          {group.chainNote && <span className={styles.chain}>{group.chainNote}</span>}
          <span className={styles.grow} />
          <span className={`${styles.faint} ${styles.num}`}>{group.runsUsed} of {group.runsMax} runs</span>
          {ticket.href && (
            <a href={ticket.href} className={styles.faint} aria-label={`Open #${ticket.number} in GitHub`}>
              <Icon name="external" size={13} />
            </a>
          )}
        </div>
      </td>
    </tr>
  );
}

export interface RunRowProps {
  run: RunSummary;
  tree: 'mid' | 'last';
  href: string;
  actions?: ReactNode;
}

export function RunRow({ run, tree, href, actions }: RunRowProps) {
  const idle = run.status === 'idle';
  const { ticket, triggeredBy } = run;
  return (
    <tr className={[styles.child, idle && styles.needs].filter(Boolean).join(' ')}>
      <td className={styles.runCell}>
        <span className={[styles.tree, tree === 'mid' && styles.mid].filter(Boolean).join(' ')} aria-hidden="true" />
        <AppLink href={href} className={`${styles.num} ${styles.runLink}`}>Run {run.id}</AppLink>
      </td>
      <td>
        <StatusBadge status={run.status} variant={idle ? 'pill' : 'text'} />
        {run.statusNote && <div className={styles.note}>{run.statusNote}</div>}
      </td>
      <td><TicketRef kind={ticket.kind} number={ticket.number} short={ticket.kind === 'issue'} /></td>
      <td className={styles.skill}>{run.skill}</td>
      <td className={styles.actor}>
        <span className={styles.actorRow}>
          <Avatar size="sm" kind={triggeredBy.bot ? 'bot' : 'user'} initials={triggeredBy.initials ?? initialsOf(triggeredBy.login)} />
          {triggeredBy.login}
        </span>
      </td>
      <td className={`${styles.num} ${styles.muted}`}>{run.startedAt}</td>
      <td className={styles.num}>{run.duration ?? <span className={styles.faint}>—</span>}</td>
      <td className={styles.actions}>{actions}</td>
    </tr>
  );
}
