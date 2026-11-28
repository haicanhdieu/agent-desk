import { useId } from 'react';
import { Button, LabelChip } from '@/ds';
import type { PlatformAdminRowView } from '@/mocks/platform/admins';
import type { DataTableColumn } from './DataTable';
import styles from './PlatformAdminRow.module.css';

export interface PlatformAdminRowProps {
  row: PlatformAdminRowView;
  /** A row action is in flight: Revoke is disabled. */
  busy?: boolean;
  onRevoke: (row: PlatformAdminRowView) => void;
}

export const platformAdminColumns: DataTableColumn[] = [
  { key: 'name', header: 'Name' },
  { key: 'email', header: 'Email' },
  { key: 'handle', header: 'Handle' },
  { key: 'added', header: 'Added' },
  { key: 'addedBy', header: 'Added by' },
  { key: 'actions', header: <span className="sr-only">Actions</span>, align: 'right' },
];

const Dash = () => <span className={styles.faint}>—</span>;

/** One row of the platform admins table. Text only, never HTML. */
export function PlatformAdminRow({ row, busy, onRevoke }: PlatformAdminRowProps) {
  const reasonId = useId();
  return (
    <tr>
      <td data-label="Name">
        <span className={styles.name}>
          {row.neverSignedIn || !row.name ? (
            <span className={styles.muted}>Not signed in yet</span>
          ) : (
            <span className={styles.nameText} title={row.name}>
              {row.name}
            </span>
          )}
          {row.you && <LabelChip name="You" />}
        </span>
      </td>
      <td className={styles.cell} data-label="Email">
        {row.email}
      </td>
      <td className={`${styles.cell} ${styles.mono}`} data-label="Handle">
        {!row.neverSignedIn && row.handle ? row.handle : <Dash />}
      </td>
      <td className={styles.cell} data-label="Added">
        <span title={row.addedAt.title}>{row.addedAt.label}</span>
      </td>
      <td className={styles.cell} data-label="Added by">
        {!row.neverSignedIn && row.addedBy ? row.addedBy : <Dash />}
      </td>
      <td className={styles.actionsCell}>
        <span className={styles.actions}>
          {row.lastWorkingAdmin && (
            <span id={reasonId} className={styles.reason}>
              Last admin
            </span>
          )}
          <Button
            variant="danger"
            size="sm"
            aria-label={`Revoke platform access for ${row.email}`}
            disabled={busy || row.lastWorkingAdmin}
            title={row.lastWorkingAdmin ? 'Grant the role to someone else first.' : undefined}
            aria-describedby={row.lastWorkingAdmin ? reasonId : undefined}
            onClick={() => onRevoke(row)}
          >
            Revoke
          </Button>
        </span>
      </td>
    </tr>
  );
}
