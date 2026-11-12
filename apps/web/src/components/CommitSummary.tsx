import { Field, Icon, TextInput } from '@/ds';
import styles from './Composites.module.css';

export interface CommitSummaryProps {
  branch: string;
  author: string;
  message: string;
  files: string[];
  onMessageChange?(v: string): void;
}

export function CommitSummary({ branch, author, message, files, onMessageChange }: CommitSummaryProps) {
  return (
    <div className={styles.summary}>
      <span className={styles.summaryHead}>
        <Icon name="commit" size={16} />
        <span>One commit to <span className={styles.monoText}>{branch}</span> as <span className={styles.monoText}>{author}</span></span>
      </span>
      <Field label="Commit message">
        {({ id }) => <TextInput mono id={id} value={message} readOnly={!onMessageChange} onChange={(e) => onMessageChange?.(e.target.value)} />}
      </Field>
      <ul className={styles.files}>
        {files.map((f) => <li key={f}>+ {f}</li>)}
      </ul>
    </div>
  );
}
