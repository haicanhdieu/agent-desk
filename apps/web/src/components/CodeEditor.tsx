import { highlightMarkdown, highlightShell } from './highlightMarkdown';
import styles from './CodeEditor.module.css';

export type CodeEditorProps = {
  value: string;
  onChange?: (value: string) => void;
  readOnly?: boolean;
  /** 1-based line numbers to mark as changed; out-of-range values are ignored. */
  changedLines?: number[];
  'aria-label': string;
  /** Syntax colouring; defaults to Markdown (SKILL.md). */
  language?: 'markdown' | 'shell';
};

export function CodeEditor({
  value,
  onChange,
  readOnly,
  changedLines = [],
  'aria-label': ariaLabel,
  language = 'markdown',
}: CodeEditorProps) {
  const highlight = language === 'shell' ? highlightShell : highlightMarkdown;
  const lines = value.split('\n');
  const changed = new Set(changedLines);
  return (
    <div className={styles.editor}>
      <div className={`${styles.inner} ${styles.slack}`}>
        <div data-view aria-hidden="true">
          {lines.map((text, i) => {
            const n = i + 1;
            const isChanged = changed.has(n);
            return (
              <div
                key={i}
                className={isChanged ? `${styles.line} ${styles.changed}` : styles.line}
                {...(isChanged ? { 'data-changed': '' } : {})}
              >
                <span className={styles.ln} data-ln>
                  {n}
                </span>
                {isChanged ? <span className={styles.mark}>+</span> : <span />}
                <span>
                  {highlight(text).map((s, j) =>
                    s.kind === 'plain' ? (
                      <span key={j}>{s.text}</span>
                    ) : (
                      <span key={j} className={styles[s.kind]} data-kind={s.kind}>
                        {s.text}
                      </span>
                    ),
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
          // The textarea is always wider/taller than its text (see .slack) so it never needs to
          // scroll itself; if the browser scrolls it anyway (caret reveal), snap back so the
          // text stays aligned with the highlighted view. The .editor container does the scrolling.
          onScroll={(e) => {
            const t = e.currentTarget;
            if (t.scrollLeft !== 0) t.scrollLeft = 0;
            if (t.scrollTop !== 0) t.scrollTop = 0;
          }}
          wrap="off"
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
        />
      </div>
    </div>
  );
}
