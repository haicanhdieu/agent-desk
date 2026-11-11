import type { AnchorHTMLAttributes, ButtonHTMLAttributes } from 'react';
import { Icon } from './Icon';
import type { IconName } from './icons';
import styles from './Button.module.css';

type Variant = 'default' | 'primary' | 'go' | 'danger' | 'solid-danger' | 'ghost';
type Size = 'sm' | 'md' | 'lg';

export type ButtonProps = {
  variant?: Variant;
  size?: Size;
  icon?: IconName;
  iconRight?: IconName;
  href?: string;
} & ButtonHTMLAttributes<HTMLButtonElement>;

const cx = (...c: Array<string | false | undefined>) => c.filter(Boolean).join(' ');

function classes(variant: Variant, size: Size, extra?: string, className?: string, dis?: boolean) {
  return cx(
    styles.btn,
    variant !== 'default' && styles[variant],
    size !== 'md' && styles[size],
    extra,
    dis && styles.dis,
    className,
  );
}

export function Button({
  variant = 'default', size = 'md', icon, iconRight, href, className, children, disabled, ...rest
}: ButtonProps) {
  const cls = classes(variant, size, undefined, className);
  const content = (
    <>
      {icon && <Icon name={icon} />}
      {children}
      {iconRight && <Icon name={iconRight} />}
    </>
  );
  if (href && !disabled) {
    return (
      <a {...(rest as unknown as AnchorHTMLAttributes<HTMLAnchorElement>)} href={href} className={cls}>
        {content}
      </a>
    );
  }
  return (
    <button type="button" {...rest} disabled={disabled} className={cls}>
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
