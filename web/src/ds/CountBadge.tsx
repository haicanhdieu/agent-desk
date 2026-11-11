import styles from './Chips.module.css';

export interface CountBadgeProps {
  count?: number;
  label?: string;
  title?: string;
}

export function CountBadge({ count, label, title }: CountBadgeProps) {
  if (!count) return null;
  return <span className={styles['count-idle']} title={title}>{label ? `${count} ${label}` : count}</span>;
}
