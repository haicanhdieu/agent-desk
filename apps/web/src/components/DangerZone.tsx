import { Button } from '@/ds';
import styles from './Composites.module.css';

export interface DangerZoneProps {
  title: string;
  body: string;
  actionLabel: string;
  onAction?(): void;
}

export function DangerZone({ title, body, actionLabel, onAction }: DangerZoneProps) {
  return (
    <div className={styles.danger}>
      <div className={styles.dangerText}>
        <b>{title}</b>
        <div className={styles.dangerBody}>{body}</div>
      </div>
      <Button variant="danger" onClick={onAction}>
        {actionLabel}
      </Button>
    </div>
  );
}
