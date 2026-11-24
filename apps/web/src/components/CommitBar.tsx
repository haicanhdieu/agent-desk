import { Button, Field, StaticInput, TextInput } from '@/ds';
import styles from './Composites.module.css';

export interface CommitBarProps {
  message: string;
  onMessageChange?(v: string): void;
  /** The branch the changes target (the project's default branch); null when it is not known. */
  branch: string | null;
  dirty: boolean;
  onDiscard?(): void;
  onCommit?(): void;
  note: string;
  /** A submission is in flight: the action stays disabled so a double click cannot send two. */
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
        <Field className={styles.commitTo} label="Target" labelAs="span">
          {({ labelId }) => (
            <StaticInput icon="branch" aria-labelledby={labelId}>
              <span className={styles.branchSpan}>
                {branch === null ? (
                  <span className={styles.monoText}>Default branch</span>
                ) : (
                  <>
                    <span className={styles.monoText}>{branch}</span>
                    <span className={styles.faintText}>default branch</span>
                  </>
                )}
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
          {pending ? 'Submitting…' : 'Submit changes'}
        </Button>
      </div>
      <p className={styles.note}>{note}</p>
    </div>
  );
}
