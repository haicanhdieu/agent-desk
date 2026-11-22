import type { AuditRowView } from '@/mocks/types';
import type { DataTableColumn } from './DataTable';
import styles from './AuditRow.module.css';

export const auditColumns: DataTableColumn[] = [
  { key: 'when', header: 'When' },
  { key: 'who', header: 'Who' },
  { key: 'what', header: 'What' },
];

/** One audit entry: time, actor, and what happened. Every string renders as React text only. */
export function AuditRow({ row }: { row: AuditRowView }) {
  const { when, who, what } = row;
  return (
    <tr>
      <td className={styles.when}>
        <time dateTime={when.iso} title={when.exact}>
          {when.label} <span className="sr-only">{when.exact}</span>
        </time>
      </td>
      <td className={styles.who}>
        <span className={who.tag === 'deleted' ? styles.gone : undefined}>{who.label}</span>
        {who.tag === 'platform' && <span className={styles.tag}>Platform admin</span>}
      </td>
      <td className={styles.whatCell}>
        {what.kind === 'sentence' ? (
          <span className={styles.what} title={what.title}>
            {what.parts.map((part, i) => (part.strong ? <b key={i}>{part.text}</b> : part.text))}
          </span>
        ) : (
          <span className={styles.what} title={what.target ? `${what.key} ${what.target}` : what.key}>
            <span className="mono">{what.key}</span>
            {what.target && <span className={styles.target}> {what.target}</span>}
          </span>
        )}
      </td>
    </tr>
  );
}
