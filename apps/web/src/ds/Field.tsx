import { useId, type ReactNode } from 'react';
import styles from './Form.module.css';

export interface FieldProps {
  label: ReactNode;
  labelAs?: 'label' | 'span';
  help?: ReactNode;
  error?: string;
  className?: string;
  /** `labelId` is set when `labelAs="span"`, for `aria-labelledby` on a control group. */
  children: (ids: { id: string; describedBy?: string; invalid?: boolean; labelId?: string }) => ReactNode;
}

export function Field({ label, labelAs = 'label', help, error, className, children }: FieldProps) {
  const id = useId();
  const helpId = `${id}-help`;
  const errorId = `${id}-error`;
  const labelId = labelAs === 'span' ? `${id}-label` : undefined;
  const describedBy = [help ? helpId : '', error ? errorId : ''].filter(Boolean).join(' ') || undefined;
  return (
    <div className={[styles.field, className].filter(Boolean).join(' ')}>
      {labelAs === 'label' ? (
        <label htmlFor={id}>{label}</label>
      ) : (
        <span id={labelId} className={styles.flabel}>
          {label}
        </span>
      )}
      {children({ id, describedBy, invalid: error ? true : undefined, labelId })}
      {help && (
        <span id={helpId} className={styles.help}>
          {help}
        </span>
      )}
      {error && (
        <span id={errorId} className={styles.error}>
          {error}
        </span>
      )}
    </div>
  );
}
