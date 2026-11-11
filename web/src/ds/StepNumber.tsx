import { Icon } from './Icon';
import styles from './Chips.module.css';

export interface StepNumberProps {
  n?: number;
  state?: 'todo' | 'current' | 'done';
}

export function StepNumber({ n, state = 'todo' }: StepNumberProps) {
  const cls = [styles.sn, state !== 'todo' && styles[state]].filter(Boolean).join(' ');
  return <span className={cls}>{state === 'done' ? <Icon name="check" size={14} strokeWidth={2.4} /> : n}</span>;
}
