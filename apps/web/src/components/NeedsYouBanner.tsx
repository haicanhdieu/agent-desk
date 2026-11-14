import type { ReactNode } from 'react';
import { Banner, Button, StatusIcon, TicketRef } from '@/ds';
import type { RunSummary } from '@/mocks/types';
import styles from './Composites.module.css';

export interface NeedsYouBannerProps {
  run: RunSummary;
  /** Full phrase, e.g. "3 minutes ago". */
  askedAgo: string;
  slotNote: ReactNode;
  href: string;
  onFinish?(): void;
}

/** Pinned amber banner at the top of Runs while a run is idle. */
export function NeedsYouBanner({ run, askedAgo, slotNote, href, onFinish }: NeedsYouBannerProps) {
  return (
    <Banner
      tone="idle"
      centered
      icon={<StatusIcon status="idle" size={18} />}
      iconColor="var(--idle)"
      title={
        <span className={styles.nyLead}>
          <b>Run {run.id} needs you.</b> <span className="mono">{run.skill}</span> on{' '}
          <TicketRef kind={run.ticket.kind} number={run.ticket.number} /> asked a question {askedAgo}.
        </span>
      }
      actions={
        <>
          <Button variant="go" icon="terminal" href={href}>
            Answer in terminal
          </Button>
          <Button onClick={onFinish}>Finish run</Button>
        </>
      }
    >
      {slotNote}
    </Banner>
  );
}
