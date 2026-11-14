import { Button, Field, StaticInput, TextInput } from '@/ds';
import styles from './Composites.module.css';

export interface CommitBarProps {
  message: string;
  onMessageChange?(v: string): void;
  branch: string;
  dirty: boolean;
  onDiscard?(): void;
  onCommit?(): void;
  note: string;
  /** A commit is in flight: Commit stays disabled so a double click cannot send two. */
  pending?: boolean;
}

export function CommitBar({
  message,
  onMessageChange,
  branch,
  dirty,
  onDiscard,
  onCommit,
  note,
  pending = false,
}: CommitBarProps) {
  return (
    <div className={styles.commitBar}>
      <div className={styles.commitRow}>
        <Field className={styles.commitMsg} label="Commit message">
          {({ id }) => (
            <TextInput
              mono
              id={id}
              value={message}
              readOnly={!onMessageChange}
              onChange={(e) => onMessageChange?.(e.target.value)}
            />
          )}
        </Field>
        <Field className={styles.commitTo} label="Commit to" labelAs="span">
          {({ labelId }) => (
            <StaticInput icon="branch" aria-labelledby={labelId}>
              <span className={styles.branchSpan}>
                <span className={styles.monoText}>{branch}</span>
                <span className={styles.faintText}>default branch</span>
              </span>
            </StaticInput>
          )}
        </Field>
        <Button variant="ghost" onClick={onDiscard}>
          Discard
        </Button>
        <Button
          variant="primary"
          icon="commit"
          disabled={!dirty || pending}
          aria-busy={pending || undefined}
          onClick={onCommit}
        >
          Commit to {branch}
        </Button>
      </div>
      <p className={styles.note}>{note}</p>
    </div>
  );
}
