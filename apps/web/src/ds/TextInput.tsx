import { useState, type InputHTMLAttributes, type ReactNode } from 'react';
import { Icon } from './Icon';
import { IconButton } from './Button';
import type { IconName } from './icons';
import styles from './Form.module.css';

const cx = (...c: Array<string | false | undefined>) => c.filter(Boolean).join(' ');

export type TextInputProps = { mono?: boolean; numeric?: boolean } & InputHTMLAttributes<HTMLInputElement>;

export function TextInput({ mono, numeric, className, type = 'text', ...rest }: TextInputProps) {
  return (
    <input type={type} {...rest} className={cx(styles.input, mono && styles.mono, numeric && styles.num, className)} />
  );
}

export function PrefixInput({
  prefix,
  className,
  ...rest
}: { prefix: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className={cx(styles.wrap, styles.prefix, className)} aria-invalid={rest['aria-invalid']}>
      <span aria-hidden="true">{prefix}</span>
      <input type="text" {...rest} />
    </div>
  );
}

export function UnitInput({ unit, className, ...rest }: { unit: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className={cx(styles.unit, className)}>
      <input type="text" inputMode="numeric" {...rest} className={cx(styles.input, styles.num)} />
      <span>{unit}</span>
    </div>
  );
}

export function PasswordInput({
  revealLabel,
  className,
  ...rest
}: { revealLabel: string } & InputHTMLAttributes<HTMLInputElement>) {
  const [shown, setShown] = useState(false);
  return (
    <div className={cx(styles.wrap, styles.pw, className)} aria-invalid={rest['aria-invalid']}>
      <input
        autoComplete="new-password"
        data-1p-ignore
        data-lpignore="true"
        spellCheck={false}
        {...rest}
        type={shown ? 'text' : 'password'}
      />
      <IconButton
        icon="eye"
        size="sm"
        aria-label={revealLabel}
        aria-pressed={shown}
        onClick={() => setShown((s) => !s)}
      />
    </div>
  );
}

export function SearchInput({
  placeholder,
  className,
  ...rest
}: { placeholder: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className={cx(styles.wrap, styles.search, className)}>
      <Icon name="search" size={14} />
      <input type="search" placeholder={placeholder} {...rest} />
    </div>
  );
}

export function StaticInput({
  icon,
  children,
  'aria-labelledby': labelledBy,
}: {
  icon?: IconName;
  children: ReactNode;
  'aria-labelledby'?: string;
}) {
  return (
    <div
      className={cx(styles.wrap, styles.static)}
      role={labelledBy ? 'group' : undefined}
      aria-labelledby={labelledBy}
    >
      {icon && <Icon name={icon} size={14} />}
      <span>{children}</span>
    </div>
  );
}
