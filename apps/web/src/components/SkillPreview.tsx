import type { ComponentProps, ReactNode } from 'react';
import { Streamdown } from 'streamdown';
import { KeyValue } from './KeyValue';
import { splitFrontMatter } from './frontMatter';
import styles from './SkillPreview.module.css';

export interface SkillPreviewProps {
  /** The editor's current text, front matter included. */
  value: string;
}

type Anchor = ComponentProps<'a'>;
type Image = ComponentProps<'img'>;

// The skill name is the column's h2, so Markdown headings sit two levels down (h1 -> h3 ... capped at h6).
const HEADING_TAGS = { 1: 'h3', 2: 'h4', 3: 'h5', 4: 'h6', 5: 'h6', 6: 'h6' } as const;

function heading(level: keyof typeof HEADING_TAGS) {
  const Tag = HEADING_TAGS[level];
  return function Heading({ children }: { children?: ReactNode }) {
    return <Tag className={styles[`md${level}`]}>{children}</Tag>;
  };
}

function Link({ href, children }: Anchor) {
  if (!href) return <span>{children}</span>;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
}

// Images are never fetched: show the alt text, or the URL when there is none.
function ImageAsText({ alt, src }: Image) {
  const label = alt?.trim() ? alt : typeof src === 'string' ? src : '';
  return <span>{label}</span>;
}

const components = {
  h1: heading(1),
  h2: heading(2),
  h3: heading(3),
  h4: heading(4),
  h5: heading(5),
  h6: heading(6),
  a: Link,
  img: ImageAsText,
};

const EMPTY = 'Nothing to preview yet. Write the skill in Edit.';

export function SkillPreview({ value }: SkillPreviewProps) {
  const { fields, body } = splitFrontMatter(value);
  const empty = body.trim() === '';
  return (
    <section className={styles.preview} aria-label="Skill preview">
      {fields.length > 0 && (
        <div className={styles.fields}>
          <KeyValue items={fields.map((f) => ({ term: f.key, value: f.value }))} />
        </div>
      )}
      {empty ? (
        <p className={styles.empty}>{EMPTY}</p>
      ) : (
        <div className={styles.body}>
          <Streamdown
            mode="static"
            parseIncompleteMarkdown={false}
            skipHtml
            controls={false}
            linkSafety={{ enabled: false }}
            components={components}
          >
            {body}
          </Streamdown>
        </div>
      )}
    </section>
  );
}

export default SkillPreview;
