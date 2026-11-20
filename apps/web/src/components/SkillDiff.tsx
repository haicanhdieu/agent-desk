import { highlightMarkdown } from './highlightMarkdown';
import { lineDiff } from './lineDiff';
import styles from './SkillDiff.module.css';

export interface SkillDiffProps {
  /** The skill as last loaded from main (skill.body). */
  base: string;
  /** The editor's current text. */
  draft: string;
}

export function SkillDiff({ base, draft }: SkillDiffProps) {
  const lines = lineDiff(base, draft);
  const unchanged = lines.every((l) => l.kind === 'same');
  return (
    <section className={styles.diff} aria-label="Changes against main">
      {unchanged ? (
        <p className={styles.empty}>No changes. The editor matches main.</p>
      ) : (
        <div className={styles.inner}>
          {lines.map((line, i) => (
            <div
              key={i}
              className={`${styles.row} ${line.kind === 'add' ? styles.add : line.kind === 'del' ? styles.del : ''}`}
              data-kind={line.kind}
            >
              <span className={styles.ln} data-base-no>
                {line.baseNo ?? ''}
              </span>
              <span className={styles.ln} data-draft-no>
                {line.draftNo ?? ''}
              </span>
              <span className={styles.glyph} data-glyph aria-hidden="true">
                {line.kind === 'add' ? '+' : line.kind === 'del' ? '−' : ''}
              </span>
              {line.kind !== 'same' && <span className="sr-only">{line.kind === 'add' ? 'Added' : 'Removed'}</span>}
              <span className={styles.text} data-text>
                {highlightMarkdown(line.text).map((s, j) =>
                  s.kind === 'plain' ? (
                    <span key={j}>{s.text}</span>
                  ) : (
                    <span key={j} className={styles[s.kind]}>
                      {s.text}
                    </span>
                  ),
                )}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
