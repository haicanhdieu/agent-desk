import { useId } from 'react';
import { Button, Icon, InlineStatus, Skeleton } from '@/ds';
import styles from './Composites.module.css';

/** The system lines Agent Desk appends to every custom prompt, as served by the API (prototype shape). */
export type PromptPreview =
  { state: 'loading' } | { state: 'error'; onRetry?(): void } | { state: 'ready'; systemLines: string[] };

export interface PromptSystemPartProps {
  preview: PromptPreview;
}

/** Placeholders such as `<issue or PR #number>` are set off from the fixed text. */
function Line({ text }: { text: string }) {
  return (
    <span className={styles.sysLine}>
      {text.split(/(<[^<>]+>)/).map((part, i) =>
        /^<[^<>]+>$/.test(part) ? (
          <span key={i} className={styles.sysPh}>
            {part}
          </span>
        ) : (
          part
        ),
      )}
    </span>
  );
}

/** Read-only view of the fixed part of a custom prompt. Users can see it but never edit it. */
export function PromptSystemPart({ preview }: PromptSystemPartProps) {
  const labelId = useId();
  return (
    <div
      className={styles.sysPart}
      role="group"
      aria-labelledby={labelId}
      aria-busy={preview.state === 'loading' || undefined}
    >
      <span id={labelId} className={styles.sysLabel}>
        <Icon name="lock" size={13} />
        Added by Agent Desk (can&apos;t be edited)
      </span>
      {preview.state === 'loading' && (
        <div className={styles.sysBlock}>
          <Skeleton variant="text" lines={3} />
          <span className="sr-only">Loading the lines Agent Desk adds</span>
        </div>
      )}
      {preview.state === 'error' && (
        <div className={`${styles.sysBlock} ${styles.sysError}`} role="alert">
          <InlineStatus tone="err" icon={<Icon name="warning" size={14} />}>
            Could not load the lines Agent Desk adds. They are still added to every run.
          </InlineStatus>
          {preview.onRetry && (
            <Button size="sm" icon="refresh" onClick={preview.onRetry}>
              Retry
            </Button>
          )}
        </div>
      )}
      {preview.state === 'ready' &&
        (preview.systemLines.length === 0 ? (
          <p className={`${styles.sysBlock} ${styles.sysEmpty}`}>Agent Desk adds nothing to this prompt.</p>
        ) : (
          <p className={styles.sysBlock}>
            {preview.systemLines.map((l, i) => (
              <Line key={i} text={l} />
            ))}
          </p>
        ))}
      <span className={styles.sysHelp}>Your prompt comes first. These lines always follow it.</span>
    </div>
  );
}
