import type { ReactNode } from 'react';
import styles from './RunList.module.css';

export type DataTableColumn = { key: string; header: ReactNode; width?: number; align?: 'left' | 'right' };

export function DataTable({
  columns,
  children,
  busy,
}: {
  columns: DataTableColumn[];
  children: ReactNode;
  /** The next page is loading: marks the table aria-busy. */
  busy?: boolean | undefined;
}) {
  return (
    <table className={styles.table} aria-busy={busy || undefined}>
      <thead>
        <tr>
          {columns.map((c) => (
            <th
              key={c.key}
              scope="col"
              style={{ ...(c.width ? { width: c.width } : {}), ...(c.align === 'right' ? { textAlign: 'right' } : {}) }}
            >
              {c.header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>{children}</tbody>
    </table>
  );
}
