import styles from './Screens.module.css';

export interface OrgSuspendedProps {
  orgName: string;
}

/** What every member sees instead of a suspended organization: a fixed message, no reason, nothing loaded. */
export function OrgSuspended({ orgName }: OrgSuspendedProps) {
  return (
    <main className={styles.emptyNotice}>
      <div className={styles.emptyNoticeCol}>
        <h1>This organization is suspended</h1>
        <p className="muted">{`You can't open ${orgName} right now. Contact your Agent Desk administrator.`}</p>
      </div>
    </main>
  );
}
