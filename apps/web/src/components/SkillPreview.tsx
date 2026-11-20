import { createContext, useContext, useEffect, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import {
  Streamdown,
  defaultComponents,
  type DiagramPlugin,
  type ExtraProps,
  type MermaidErrorComponentProps,
} from 'streamdown';
import { KeyValue } from './KeyValue';
import { splitFrontMatter } from './frontMatter';
import styles from './SkillPreview.module.css';

export interface SkillPreviewProps {
  /** The editor's current text, front matter included. */
  value: string;
  /** Loads the diagram plugin's module. Stories and tests pass a pending one. Default: () => import('@streamdown/mermaid').
   *  SkillPreview always builds the plugin itself: createMermaidPlugin({ config: { securityLevel: 'strict', theme: 'dark', themeVariables } }). */
  loadMermaid?: () => Promise<typeof import('@streamdown/mermaid')>;
}

const loadMermaidDefault = () => import('@streamdown/mermaid');

// A fenced block whose language is mermaid. Only then is the diagram plugin (and Mermaid) fetched.
const MERMAID_FENCE = /^ {0,3}(`{3,}|~{3,})[ \t]*mermaid\b/m;

// Design-token colours Mermaid needs as real values: read at runtime, empty values left out (terminalTheme does the same).
const THEME_TOKENS = {
  background: '--panel',
  primaryColor: '--panel',
  primaryTextColor: '--text',
  primaryBorderColor: '--line2',
  lineColor: '--line2',
  secondaryColor: '--bg',
  tertiaryColor: '--bg',
  textColor: '--text',
} as const;

function themeVariables(): Record<string, string> {
  const style = getComputedStyle(document.documentElement);
  const out: Record<string, string> = {};
  for (const [name, token] of Object.entries(THEME_TOKENS)) {
    const value = style.getPropertyValue(token).trim();
    if (value) out[name] = value;
  }
  return out;
}

type Anchor = ComponentProps<'a'>;
type Image = ComponentProps<'img'>;

// The skill name is the column's h2, so Markdown headings sit two levels down (h1 -> h3 ... capped at h6).
const HEADING_TAGS = { 1: 'h3', 2: 'h4', 3: 'h5', 4: 'h6', 5: 'h6', 6: 'h6' } as const;

function heading(level: keyof typeof HEADING_TAGS) {
  const Tag = HEADING_TAGS[level];
  return function Heading({ children }: ComponentProps<'h1'> & ExtraProps) {
    return <Tag className={styles[`md${level}`]}>{children}</Tag>;
  };
}

function Link({ href, children }: Anchor & ExtraProps) {
  if (!href) return <span>{children}</span>;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
}

// Images are never fetched: show the alt text, or the URL when there is none.
function ImageAsText({ alt, src }: Image & ExtraProps) {
  const label = alt?.trim() ? alt : typeof src === 'string' ? src : '';
  return <span>{label}</span>;
}

function DiagramError({ error, chart, retry }: MermaidErrorComponentProps) {
  return (
    <div className={styles.diagramError} role="alert">
      <p className={styles.diagramErrorTitle}>This diagram could not be drawn</p>
      {error && <p className={styles.diagramErrorText}>{error}</p>}
      <pre>
        <code>{chart}</code>
      </pre>
      <button type="button" className={styles.retry} onClick={retry}>
        Try again
      </button>
    </div>
  );
}

const DiagramLoading = () => (
  <p className={styles.diagramLoading} role="status">
    Loading diagram…
  </p>
);

// Streamdown's own diagram placeholder reads "Loading diagram..." (three dots). The copy here is "Loading diagram…",
// so its text node is rewritten in place. Only that text is touched: React never updates it again.
const STREAMDOWN_LOADING = 'Loading diagram...';

function DiagramFrame({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const fix = () => {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if (n.nodeValue === STREAMDOWN_LOADING) n.nodeValue = 'Loading diagram…';
      }
    };
    fix();
    const observer = new MutationObserver(fix);
    observer.observe(root, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);
  return (
    <div ref={ref} className={styles.diagram}>
      {children}
    </div>
  );
}

type CodeProps = ComponentProps<typeof defaultComponents.code>;

const isMermaid = (props: CodeProps) => /language-mermaid\b/.test(props.className ?? '');

// The three Code components live at module scope: a component created per render would remount every
// code block and diagram on each keystroke elsewhere in the editor.
function CodeReady(props: CodeProps) {
  const code = <defaultComponents.code {...props} />;
  return isMermaid(props) ? <DiagramFrame>{code}</DiagramFrame> : code;
}

function CodePending(props: CodeProps) {
  return isMermaid(props) ? <DiagramLoading /> : <defaultComponents.code {...props} />;
}

// The plugin module failed to load: Try again loads it again.
const RetryLoad = createContext<() => void>(() => undefined);

function CodeFailed(props: CodeProps) {
  const retry = useContext(RetryLoad);
  if (!isMermaid(props)) return <defaultComponents.code {...props} />;
  const chart = typeof props.children === 'string' ? props.children : '';
  return <DiagramError error="" chart={chart} retry={retry} />;
}

type LoadState = 'idle' | 'pending' | 'ready' | 'failed';
const CODE_FOR = { idle: defaultComponents.code, pending: CodePending, ready: CodeReady, failed: CodeFailed } as const;

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

export function SkillPreview({ value, loadMermaid = loadMermaidDefault }: SkillPreviewProps) {
  const { fields, body } = splitFrontMatter(value);
  const empty = body.trim() === '';
  const wantsDiagrams = MERMAID_FENCE.test(body);
  const [plugin, setPlugin] = useState<DiagramPlugin | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const state: LoadState = plugin ? 'ready' : failed ? 'failed' : wantsDiagrams ? 'pending' : 'idle';
  // Once per mount, and only when the text has a mermaid fence.
  useEffect(() => {
    if (!wantsDiagrams || plugin) return;
    let live = true;
    loadMermaid().then(
      (mod) => {
        if (!live) return;
        setPlugin(
          mod.createMermaidPlugin({
            config: { securityLevel: 'strict', theme: 'dark', themeVariables: themeVariables() },
          }),
        );
      },
      () => {
        if (live) setFailed(true);
      },
    );
    return () => {
      live = false;
      setFailed(false);
    };
    // loadMermaid is a seam, not a dependency: it loads once, and again on Try again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantsDiagrams, attempt]);
  const retryLoad = () => {
    setFailed(false);
    setAttempt((n) => n + 1);
  };
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
          <RetryLoad.Provider value={retryLoad}>
            <Streamdown
              mode="static"
              parseIncompleteMarkdown={false}
              skipHtml
              controls={false}
              linkSafety={{ enabled: false }}
              components={{ ...components, code: CODE_FOR[state] }}
              plugins={plugin ? { mermaid: plugin } : undefined}
              mermaid={{ errorComponent: DiagramError }}
            >
              {body}
            </Streamdown>
          </RetryLoad.Provider>
        </div>
      )}
    </section>
  );
}

export default SkillPreview;
