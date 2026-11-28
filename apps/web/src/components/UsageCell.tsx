import type { UsageCellView } from '@/mocks/types';
import styles from './UsageCell.module.css';

/** Runs list Usage cell. The title is hover-only (the cell is not focusable); the sr-only suffix gives the meaning. */
export function UsageCell({ usage }: { usage?: UsageCellView }) {
  const view: UsageCellView = usage ?? { text: '—', title: 'No usage data', srSuffix: 'No usage data' };
  return (
    <td className={styles.cell} data-label="Usage" title={view.title}>
      {view.text}
      <span className="sr-only">{view.srSuffix}</span>
    </td>
  );
}
