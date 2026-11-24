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
  /** The request is in flight: the confirm stays disabled so a double click cannot send two. */
  pending?: boolean;
}

/** Inner body is mounted only while open, so typed text and message reset on every open. */
function Body({
  name,
  path,
  branch,
  warning,
  defaultMessage,
  onClose,
  onConfirm,
  pending = false,
}: Omit<ConfirmDeleteDialogProps, 'open'>) {
  const [message, setMessage] = useState(defaultMessage);
  const [typed, setTyped] = useState('');
  const confirmed = typed === name;
  return (
    <Dialog
      open
      title={
        <>
          Delete skill <span className="mono">{name}</span>?
        </>
      }
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Keep skill
          </Button>
          <Button
            variant="solid-danger"
            icon="trash"
            disabled={!confirmed || pending}
            aria-busy={pending || undefined}
            onClick={() => confirmed && !pending && onConfirm(message)}
          >
            {pending ? 'Submitting…' : 'Submit changes'}
          </Button>
        </>
      }
    >
      <p className={styles.confirmText}>
        This removes <span className="mono">{path}</span> from <span className="mono">{branch}</span>, or submits the
        removal for review if that branch requires it. Restore it from git history, not from Agent Desk.
      </p>
      {warning && (
        <Banner tone="warn" icon={<Icon name="warning" size={16} />}>
          {warning}
        </Banner>
      )}
      <Field label="Commit message">
        {({ id }) => <TextInput mono id={id} value={message} onChange={(e) => setMessage(e.target.value)} />}
      </Field>
      <Field
        label={
          <>
            Type <span className="mono">{name}</span> to confirm
          </>
        }
      >
        {({ id }) => (
          <TextInput
            mono
            id={id}
            value={typed}
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => setTyped(e.target.value)}
          />
        )}
      </Field>
    </Dialog>
  );
}

export function ConfirmDeleteDialog({ open, ...rest }: ConfirmDeleteDialogProps) {
  return open ? <Body key={rest.name} {...rest} /> : null;
}
