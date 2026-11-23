import { useState, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from 'react';
import { Icon } from './Icon';
import { Select } from './Select';
import type { DurationUnit } from './duration';
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

export type TextAreaProps = { mono?: boolean } & TextareaHTMLAttributes<HTMLTextAreaElement>;

/** Multi-line text, e.g. a rule's custom prompt. Grows only by the user's resize handle. */
export function TextArea({ mono, className, rows = 6, ...rest }: TextAreaProps) {
  return (
    <textarea rows={rows} {...rest} className={cx(styles.input, styles.textarea, mono && styles.mono, className)} />
  );
}

/** `prefixId` lets the input's aria-describedby point at the prefix, which is hidden from the tree. */
export function PrefixInput({
  prefix,
  prefixId,
  className,
  ...rest
}: { prefix: string; prefixId?: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className={cx(styles.wrap, styles.prefix, className)} aria-invalid={rest['aria-invalid']}>
      <span id={prefixId} aria-hidden="true">
        {prefix}
      </span>
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

const DURATION_UNITS: readonly DurationUnit[] = ['minutes', 'hours', 'days'];

/** A number with a minutes / hours / days unit control, e.g. the agent's run time limit. */
export function DurationInput({
  unit,
  onUnitChange,
  unitLabel,
  className,
  ...rest
}: {
  unit: DurationUnit;
  onUnitChange: (unit: DurationUnit) => void;
  /** Accessible name of the unit control. */
  unitLabel: string;
} & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className={cx(styles.unit, className)}>
      <input type="text" inputMode="numeric" {...rest} className={cx(styles.input, styles.num)} />
      <Select
        aria-label={unitLabel}
        aria-invalid={rest['aria-invalid']}
        value={unit}
        onChange={(e) => {
          const next = DURATION_UNITS.find((u) => u === e.target.value);
          if (next) onUnitChange(next);
        }}
      >
        {DURATION_UNITS.map((u) => (
          <option key={u} value={u}>
            {u}
          </option>
        ))}
      </Select>
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

/** A search box. With `onClear`, a trailing button (named `clearLabel`) clears a non-empty controlled value. */
export function SearchInput({
  placeholder,
  className,
  onClear,
  clearLabel = 'Clear search',
  ...rest
}: { placeholder: string; onClear?: () => void; clearLabel?: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className={cx(styles.wrap, styles.search, className)}>
      <Icon name="search" size={14} />
      <input type="search" placeholder={placeholder} {...rest} />
      {onClear && rest.value !== undefined && rest.value !== '' && (
        <IconButton icon="x" size="sm" aria-label={clearLabel} onClick={onClear} />
      )}
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
