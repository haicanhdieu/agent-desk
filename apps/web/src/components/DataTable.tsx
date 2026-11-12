import type { ReactNode } from 'react';
import styles from './RunList.module.css';

export type DataTableColumn = { key: string; header: ReactNode; width?: number; align?: 'left' | 'right' };

export function DataTable({ columns, children }: { columns: DataTableColumn[]; children: ReactNode }) {
  return (
    <table className={styles.table}>
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
