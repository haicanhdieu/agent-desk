import { Icon } from './Icon';
import styles from './Chips.module.css';

export interface AvatarProps {
  initials?: string;
  kind?: 'user' | 'bot';
  size?: 'sm' | 'md';
  title?: string;
}

export function Avatar({ initials, kind = 'user', size = 'md', title }: AvatarProps) {
  const cls = [styles.avatar, kind === 'bot' && styles.bot, size === 'sm' && styles.sm].filter(Boolean).join(' ');
  return (
    <span className={cls} title={title} {...(title ? {} : { 'aria-hidden': true })}>
      {kind === 'bot' ? <Icon name="bot" size={size === 'sm' ? 12 : 15} /> : initials}
    </span>
  );
}
