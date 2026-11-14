import { AppLink, CommandChip, StatusIcon, TicketRef, statusTokens, type RunStatus, type TicketKind } from '@/ds';
import styles from './SidePanel.module.css';

export type ChainStep = {
  runId?: number;
  command: string;
  ticket?: { kind: TicketKind; number: number };
  context?: string;
  note: string;
  status: RunStatus | 'future';
  here?: boolean;
  href?: string;
};

export function ChainTimeline({ steps }: { steps: ChainStep[] }) {
  return (
    <ol className={styles.chain}>
      {steps.map((s, i) => {
        const future = s.status === 'future';
        const body = (
          <>
            <span className={styles.crow}>
              {s.runId !== undefined && <b>Run {s.runId}</b>}
              <CommandChip>{s.command}</CommandChip>
              {s.ticket && (
                <>
                  <span className="faint">on</span>
                  <TicketRef kind={s.ticket.kind} number={s.ticket.number} />
                </>
              )}
              {!s.ticket && s.context && <span>{s.context}</span>}
            </span>
            <span className={styles.cnote}>{s.note}</span>
          </>
        );
        const cls = [styles.cstep, s.here && styles.here, future && styles.future].filter(Boolean).join(' ');
        return (
          <li key={i} className={cls} aria-current={s.here ? 'step' : undefined}>
            <div className={styles.cicon}>
              <StatusIcon
                status={future ? 'queued' : (s.status as RunStatus)}
                size={16}
                title={future ? 'Not started' : statusTokens[s.status as RunStatus].label}
              />
            </div>
            {s.href && !future ? (
              <AppLink className={styles.cbox} href={s.href}>
                {body}
              </AppLink>
            ) : (
              <div className={styles.cbox}>{body}</div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
