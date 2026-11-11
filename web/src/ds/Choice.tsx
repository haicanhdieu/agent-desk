import type { ReactNode } from 'react';
import { Icon } from './Icon';
import styles from './Form.module.css';

const cx = (...c: Array<string | false | undefined>) => c.filter(Boolean).join(' ');

export interface CheckboxProps {
  checked: boolean;
  onChange(v: boolean): void;
  'aria-label'?: string;
  disabled?: boolean;
}

export function Checkbox({ checked, onChange, disabled, ...aria }: CheckboxProps) {
  return (
    <span className={styles.choice}>
      <input
        type="checkbox"
        className={styles.native}
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        {...aria}
      />
      <span className={cx(styles.cbx, checked && styles.on)} aria-hidden="true">
        {checked && <Icon name="check" size={12} />}
      </span>
    </span>
  );
}

export interface RadioCardProps {
  type: 'radio' | 'checkbox';
  name: string;
  checked: boolean;
  onChange(v: boolean): void;
  title: ReactNode;
  description?: ReactNode;
  aside?: ReactNode;
  /** Description in --faint instead of --muted (setup repo and credential cards). */
  faintDescription?: boolean;
}

export function RadioCard({ type, name, checked, onChange, title, description, aside, faintDescription }: RadioCardProps) {
  return (
    <label className={cx(styles['radio-card'], checked && styles.sel)}>
      <span className={styles.choice}>
        <input
          type={type}
          name={name}
          className={styles.native}
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
        />
        {type === 'radio' ? (
          <span className={cx(styles.rdot, checked && styles.on)} aria-hidden="true" />
        ) : (
          <span className={cx(styles.cbx, checked && styles.on)} aria-hidden="true">
            {checked && <Icon name="check" size={12} />}
          </span>
        )}
      </span>
      <span className={styles['rc-body']}>
        <span className={styles['rc-title']}>{title}</span>
        {description && <span className={cx(styles['rc-desc'], faintDescription && styles.faint)}>{description}</span>}
      </span>
      {aside && <span className={styles['rc-aside']}>{aside}</span>}
    </label>
  );
}
