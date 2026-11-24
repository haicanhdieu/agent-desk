import type { PlatformProjectRowView } from '@/mocks/platform/tabs';
import type { DataTableColumn } from './DataTable';
import styles from './PlatformProjectRow.module.css';

export const platformProjectColumns: DataTableColumn[] = [
  { key: 'id', header: 'Id' },
  { key: 'name', header: 'Name' },
];

/** One row of an org's Projects tab for platform admins: id and name as plain text, no link, no action (BR-25). */
export function PlatformProjectRow({ row }: { row: PlatformProjectRowView }) {
  return (
    <tr>
      <td>
        <span className={styles.id} title={row.id}>
          {row.id}
        </span>
      </td>
      <td className={styles.name}>{row.name}</td>
    </tr>
  );
}
