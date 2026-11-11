import type { AnchorHTMLAttributes, ButtonHTMLAttributes } from 'react';
import { Icon } from './Icon';
import type { IconName } from './icons';
import styles from './Button.module.css';

type Variant = 'default' | 'primary' | 'go' | 'danger' | 'solid-danger' | 'ghost';
type Size = 'sm' | 'md' | 'lg';

type ButtonCommon = {
  variant?: Variant;
  size?: Size;
  icon?: IconName;
  iconRight?: IconName;
};
type AsButton = ButtonCommon & { href?: undefined } & ButtonHTMLAttributes<HTMLButtonElement>;
type AsAnchor = ButtonCommon & { href: string; disabled?: boolean } & AnchorHTMLAttributes<HTMLAnchorElement>;
export type ButtonProps = AsButton | AsAnchor;

const cx = (...c: Array<string | false | undefined>) => c.filter(Boolean).join(' ');

function classes(variant: Variant, size: Size, extra?: string, className?: string) {
  return cx(
    styles.btn,
    variant !== 'default' && styles[variant],
    size !== 'md' && styles[size],
    extra,
    className,
  );
}

export function Button({
  variant = 'default', size = 'md', icon, iconRight, className, children, ...rest
}: ButtonProps) {
  const cls = classes(variant, size, undefined, className);
  const content = (
    <>
      {icon && <Icon name={icon} />}
      {children}
      {iconRight && <Icon name={iconRight} />}
    </>
  );
  if (rest.href !== undefined) {
    const { disabled, ...anchor } = rest;
    if (!disabled) {
      return <a {...anchor} className={cls}>{content}</a>;
    }
    return (
      <button type="button" disabled className={cls} aria-label={anchor['aria-label']}>
        {content}
      </button>
    );
  }
  return (
    <button type="button" {...rest} className={cls}>
      {content}
    </button>
  );
}

export type IconButtonProps = {
  icon: IconName;
  'aria-label': string;
  variant?: 'ghost' | 'default';
  size?: Size;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'>;

export function IconButton({
  icon, variant = 'ghost', size = 'md', className, ...rest
}: IconButtonProps) {
  return (
    <button
      type="button"
      {...rest}
      className={classes(variant, size, styles.iconbtn, className)}
    >
      <Icon name={icon} size={16} />
    </button>
  );
}
