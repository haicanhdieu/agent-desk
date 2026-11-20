import { useLayoutEffect, useRef } from 'react';
import { Banner, Button, Icon, Skeleton } from '@/ds';
import styles from './Transcript.module.css';

export interface TranscriptItem {
  key: string;
  kind: 'user' | 'agent' | 'tool' | 'notice';
  /** user: 'Prompt' or 'You'; agent: the agent's name; absent for tool and notice. */
  label?: string;
  /** Local "14:13". */
  time: string;
  /** Tool name; kind 'tool' only. */
  tool?: string;
  /** Plain text (already stripped of control and bidi characters by the caller). */
  text: string;
  truncated: boolean;
}

export interface TranscriptProps {
  state: 'loading' | 'error' | 'ready';
  items: TranscriptItem[];
  /** The failed request's id (error state). */
  requestId?: string;
  onRetry?(): void;
  /** Older entries exist: shows "Show earlier messages". */
  hasEarlier?: boolean;
  loadingEarlier?: boolean;
  onShowEarlier?(): void;
}

/** Older items were added above: the old first item is still in the list, now below new ones. A replaced list is not a prepend. */
export function isPrepend(prevKeys: string[], nextKeys: string[]): boolean {
  const first = prevKeys[0];
  return first !== undefined && nextKeys[0] !== first && nextKeys.includes(first);
}

function Entry({ item }: { item: TranscriptItem }) {
  if (item.kind === 'notice') {
    return <div className={styles.notice}>{item.text}</div>;
  }
  if (item.kind === 'tool') {
    return (
      <div className={styles.tool}>
        <Icon name="terminal" size={13} />
        <b>{item.tool}</b>
        <span>{item.text}</span>
      </div>
    );
  }
  return (
    <div className={item.kind === 'user' ? `${styles.msg} ${styles.you}` : styles.msg}>
      <div className={styles.who}>
        <b>{item.label}</b>
        <span className={`num ${styles.time}`}>{item.time}</span>
      </div>
      <p className={styles.text}>
        {item.text}
        {item.truncated && (
          <>
            {' '}
            <span className={styles.cut}>… (cut)</span>
          </>
        )}
      </p>
    </div>
  );
}

/** A saved agent conversation: read-only, opens at the bottom, text is always rendered as plain text. */
export function Transcript({
  state,
  items,
  requestId,
  onRetry,
  hasEarlier,
  loadingEarlier,
  onShowEarlier,
}: TranscriptProps) {
  const logRef = useRef<HTMLDivElement>(null);
  const prev = useRef<{ keys: string[]; height: number }>({ keys: [], height: 0 });

  useLayoutEffect(() => {
    const el = logRef.current;
    if (!el) return;
    const keys = items.map((i) => i.key);
    const before = prev.current;
    if (before.height > 0 && isPrepend(before.keys, keys)) {
      // Older items were added above: keep the first visible item where it was.
      el.scrollTop += el.scrollHeight - before.height;
    } else if (before.keys.length === 0 || before.height === 0 || keys[0] !== before.keys[0]) {
      el.scrollTop = el.scrollHeight;
    }
    prev.current = { keys, height: el.scrollHeight };
  }, [items, state]);

  if (state === 'loading') {
    return (
      <div className={styles.fill}>
        <div className={styles.loading} role="status" aria-busy="true" aria-label="Loading the transcript">
          <Skeleton variant="text" lines={3} width="60%" />
          <Skeleton variant="text" lines={2} width="40%" />
          <Skeleton variant="text" lines={4} width="70%" />
        </div>
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div className={styles.fill}>
        <Banner
          tone="err"
          title="Couldn't load the transcript"
          actions={
            <Button size="sm" icon="refresh" onClick={onRetry}>
              Retry
            </Button>
          }
        >
          {requestId && <span className={styles.requestId}>Request ID {requestId}</span>}
        </Banner>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className={styles.empty}>
        <div className={styles.emptyInner}>
          <Icon name="transcript" size={28} />
          <h2>No conversation was saved for this run.</h2>
        </div>
      </div>
    );
  }

  return (
    <div ref={logRef} className={styles.log} role="log" aria-label="Transcript of the agent conversation">
      {hasEarlier && (
        <Button
          variant="ghost"
          size="sm"
          icon="chevron-up"
          className={styles.more}
          disabled={loadingEarlier}
          onClick={onShowEarlier}
        >
          Show earlier messages
        </Button>
      )}
      {items.map((item) => (
        <Entry key={item.key} item={item} />
      ))}
    </div>
  );
}
