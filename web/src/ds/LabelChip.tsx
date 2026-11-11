import { Icon } from './Icon';
import styles from './Chips.module.css';

export interface LabelChipProps {
  name: string;
  color?: string;
  tone?: 'default' | 'idle';
  onRemove?: () => void;
}

export function LabelChip({ name, color, tone = 'default', onRemove }: LabelChipProps) {
  return (
    <span className={[styles.lbl, tone === 'idle' && styles.idle].filter(Boolean).join(' ')}>
      {color && <i aria-hidden="true" style={{ background: color }} />}
      {name}
      {onRemove && (
        <button type="button" className={styles['lbl-x']} aria-label={`Remove label ${name}`} onClick={onRemove}>
          <Icon name="x" size={12} />
        </button>
      )}
    </span>
  );
}
