import { AppLink } from '@/ds';
import type { PlatformOrgRowView } from '@/mocks/platform/orgs';
import type { DataTableColumn } from './DataTable';
import { OrgStatus } from './OrgStatus';
import styles from './PlatformOrgRow.module.css';

export const platformOrgColumns: DataTableColumn[] = [
  { key: 'name', header: 'Organization' },
  { key: 'owner', header: 'Owner' },
  { key: 'members', header: 'Members', align: 'right' },
  { key: 'projects', header: 'Projects', align: 'right' },
  { key: 'lastActivity', header: 'Last activity' },
  { key: 'status', header: 'Status' },
  { key: 'created', header: 'Created' },
];

/** One row of the platform Organizations directory. Text only, never HTML. */
export function PlatformOrgRow({ row }: { row: PlatformOrgRowView }) {
  return (
    <tr>
      <td>
        <span className={styles.name}>
          <AppLink href={row.href} className={styles.link} title={row.name}>
            {row.name}
          </AppLink>
          <span className={styles.slug}>/o/{row.slug}</span>
        </span>
      </td>
      <td className={styles.cell}>{row.owner ?? <span className={styles.muted}>No owner yet</span>}</td>
      <td className={`${styles.cell} ${styles.num}`}>{row.members}</td>
      <td className={`${styles.cell} ${styles.num}`}>{row.projects}</td>
      <td className={styles.cell}>
        {row.lastActivity ? (
          <span title={row.lastActivity.title}>{row.lastActivity.label}</span>
        ) : (
          <span className={styles.muted}>No activity yet</span>
        )}
      </td>
      <td>
        <OrgStatus status={row.status} />
      </td>
      <td className={styles.cell}>
        <span title={row.created.title}>{row.created.label}</span>
      </td>
    </tr>
  );
}
