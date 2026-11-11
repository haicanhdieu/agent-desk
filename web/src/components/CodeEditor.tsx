import { highlightMarkdown } from './highlightMarkdown';
import styles from './CodeEditor.module.css';

export type CodeEditorProps = {
  value: string;
  onChange?: (value: string) => void;
  readOnly?: boolean;
  /** 1-based line numbers to mark as changed; out-of-range values are ignored. */
  changedLines?: number[];
  'aria-label': string;
};

export function CodeEditor({ value, onChange, readOnly, changedLines = [], 'aria-label': ariaLabel }: CodeEditorProps) {
  const lines = value.split('\n');
  const changed = new Set(changedLines);
  return (
    <div className={styles.editor}>
      <div className={styles.inner}>
        <div data-view aria-hidden="true">
          {lines.map((text, i) => {
            const n = i + 1;
            const isChanged = changed.has(n);
            return (
              <div key={i} className={isChanged ? `${styles.line} ${styles.changed}` : styles.line} {...(isChanged ? { 'data-changed': '' } : {})}>
                <span className={styles.ln} data-ln>{n}</span>
                {isChanged ? <span className={styles.mark}>+</span> : <span />}
                <span>
                  {highlightMarkdown(text).map((s, j) =>
                    s.kind === 'plain'
                      ? <span key={j}>{s.text}</span>
                      : <span key={j} className={styles[s.kind]} data-kind={s.kind}>{s.text}</span>,
                  )}
                </span>
              </div>
            );
          })}
        </div>
        <textarea
          className={styles.ta}
          aria-label={ariaLabel}
          value={value}
          readOnly={readOnly}
          onChange={(e) => onChange?.(e.target.value)}
          wrap="off"
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
        />
      </div>
    </div>
  );
}
