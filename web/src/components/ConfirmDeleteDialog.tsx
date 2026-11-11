import { useState, type ReactNode } from 'react';
import { Banner, Button, Dialog, Field, Icon, TextInput } from '@/ds';
import styles from './Composites.module.css';

export interface ConfirmDeleteDialogProps {
  open: boolean;
  name: string;
  path: string;
  branch: string;
  warning?: ReactNode;
  defaultMessage: string;
  onClose(): void;
  onConfirm(message: string): void;
}

/** Inner body is mounted only while open, so typed text and message reset on every open. */
function Body({ name, path, branch, warning, defaultMessage, onClose, onConfirm }: Omit<ConfirmDeleteDialogProps, 'open'>) {
  const [message, setMessage] = useState(defaultMessage);
  const [typed, setTyped] = useState('');
  const confirmed = typed === name;
  return (
    <Dialog
      open
      title={<>Delete skill <span className="mono">{name}</span>?</>}
      onClose={onClose}
      footer={(
        <>
          <Button variant="ghost" onClick={onClose}>Keep skill</Button>
          <Button variant="solid-danger" icon="trash" disabled={!confirmed} onClick={() => confirmed && onConfirm(message)}>Delete and commit</Button>
        </>
      )}
    >
      <p className={styles.confirmText}>
        This commits the removal of <span className="mono">{path}</span> to <span className="mono">{branch}</span>. You can restore it from git history, not from Agent Desk.
      </p>
      {warning && <Banner tone="warn" icon={<Icon name="warning" size={16} />}>{warning}</Banner>}
      <Field label="Commit message">
        {({ id }) => <TextInput mono id={id} value={message} onChange={(e) => setMessage(e.target.value)} />}
      </Field>
      <Field label={<>Type <span className="mono">{name}</span> to confirm</>}>
        {({ id }) => <TextInput mono id={id} value={typed} autoComplete="off" spellCheck={false} onChange={(e) => setTyped(e.target.value)} />}
      </Field>
    </Dialog>
  );
}

export function ConfirmDeleteDialog({ open, ...rest }: ConfirmDeleteDialogProps) {
  return open ? <Body {...rest} /> : null;
}
