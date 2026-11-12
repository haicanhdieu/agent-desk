import { useState, type KeyboardEvent } from 'react';
import { LabelChip } from './LabelChip';
import styles from './Form.module.css';

export interface LabelInputProps {
  labels: string[];
  onAdd(l: string): void;
  onRemove(l: string): void;
  id?: string;
  placeholder?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
}

export function LabelInput({
  labels, onAdd, onRemove, id, placeholder, 'aria-describedby': describedBy, 'aria-invalid': invalid,
}: LabelInputProps) {
  const [text, setText] = useState('');

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      const v = text.trim();
      if (!v) return;
      onAdd(v);
      setText('');
    } else if (e.key === 'Backspace' && text === '' && labels.length > 0) {
      onRemove(labels[labels.length - 1]);
    }
  };

  return (
    <div className={styles.lblinput}>
      {labels.map((l) => (
        <LabelChip key={l} name={l} onRemove={() => onRemove(l)} />
      ))}
      <input
        id={id}
        aria-describedby={describedBy}
        aria-invalid={invalid}
        value={text}
        placeholder={placeholder}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
      />
    </div>
  );
}
