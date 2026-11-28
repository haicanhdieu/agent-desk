import type { PlatformProjectRowView } from '@/mocks/platform/tabs';
import type { DataTableColumn } from './DataTable';
import styles from './PlatformProjectRow.module.css';

export const platformProjectColumns: DataTableColumn[] = [
  { key: 'name', header: 'Name' },
  { key: 'id', header: 'Id' },
];

/** One row of an org's Projects tab for platform admins: name and id as plain text, no link, no action (BR-25). */
export function PlatformProjectRow({ row }: { row: PlatformProjectRowView }) {
  return (
    <tr>
      <td className={styles.name} data-label="Name">
        {row.name}
      </td>
      <td data-label="Id">
        <span className={styles.id} title={row.id}>
          {row.id}
        </span>
      </td>
    </tr>
  );
}
