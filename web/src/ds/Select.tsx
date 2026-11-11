import type { SelectHTMLAttributes } from 'react';
import styles from './Form.module.css';

export function Select({ mono, className, ...rest }: { mono?: boolean } & SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...rest} className={[styles.input, mono && styles.mono, className].filter(Boolean).join(' ')} />;
}
