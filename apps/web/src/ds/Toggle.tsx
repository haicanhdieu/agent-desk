import styles from './Form.module.css';

export interface ToggleProps {
  checked: boolean;
  onChange(v: boolean): void;
  'aria-label'?: string;
  'aria-labelledby'?: string;
  disabled?: boolean;
}

export function Toggle({ checked, onChange, disabled, ...aria }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      className={[styles.toggle, checked && styles.on].filter(Boolean).join(' ')}
      onClick={() => onChange(!checked)}
      {...aria}
    />
  );
}
