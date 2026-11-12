import { Field, Icon, TextInput } from '@/ds';
import styles from './Composites.module.css';

export interface CommitSummaryProps {
  branch: string;
  author: string;
  message: string;
  files: string[];
  onMessageChange?(v: string): void;
  /** Message from a failed commit, shown under the commit message. */
  error?: string;
}

export function CommitSummary({ branch, author, message, files, onMessageChange, error }: CommitSummaryProps) {
  return (
    <div className={styles.summary}>
      <span className={styles.summaryHead}>
        <Icon name="commit" size={16} />
        <span>One commit to <span className={styles.monoText}>{branch}</span> as <span className={styles.monoText}>{author}</span></span>
      </span>
      <Field label="Commit message" error={error}>
        {({ id, describedBy, invalid }) => (
          <TextInput
            mono id={id} aria-describedby={describedBy} aria-invalid={invalid} value={message} readOnly={!onMessageChange}
            onChange={(e) => onMessageChange?.(e.target.value)}
          />
        )}
      </Field>
      <ul className={styles.files}>
        {files.map((f) => <li key={f}>+ {f}</li>)}
      </ul>
    </div>
  );
}
