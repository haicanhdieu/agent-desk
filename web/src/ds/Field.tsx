import { useId, type ReactNode } from 'react';
import styles from './Form.module.css';

export interface FieldProps {
  label: ReactNode;
  labelAs?: 'label' | 'span';
  help?: ReactNode;
  error?: string;
  className?: string;
  children: (ids: { id: string; describedBy?: string; invalid?: boolean }) => ReactNode;
}

export function Field({ label, labelAs = 'label', help, error, className, children }: FieldProps) {
  const id = useId();
  const helpId = `${id}-help`;
  const errorId = `${id}-error`;
  const describedBy = [help ? helpId : '', error ? errorId : ''].filter(Boolean).join(' ') || undefined;
  return (
    <div className={[styles.field, className].filter(Boolean).join(' ')}>
      {labelAs === 'label' ? (
        <label htmlFor={id}>{label}</label>
      ) : (
        <span id={`${id}-label`} className={styles.flabel}>{label}</span>
      )}
      {children({ id, describedBy, invalid: error ? true : undefined })}
      {help && <span id={helpId} className={styles.help}>{help}</span>}
      {error && <span id={errorId} className={styles.error}>{error}</span>}
    </div>
  );
}
