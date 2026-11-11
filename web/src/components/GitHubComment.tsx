import type { ReactNode } from 'react';
import { Avatar } from '@/ds';
import styles from './Composites.module.css';

export interface GitHubCommentProps {
  author: string;
  /** Muted text after the author, e.g. "commented on PR #148, edited 14:13". */
  meta: ReactNode;
  bot?: boolean;
  children: ReactNode;
}

/** A comment as GitHub shows it: header strip plus body. */
export function GitHubComment({ author, meta, bot, children }: GitHubCommentProps) {
  return (
    <div className={styles.ghComment}>
      <div className={styles.ghHead}>
        <Avatar size="sm" kind={bot ? 'bot' : 'user'} initials={author.slice(0, 2).toUpperCase()} />
        <b>{author}</b>
        <span className={styles.ghMeta}>{meta}</span>
      </div>
      <div className={styles.ghBody}>{children}</div>
    </div>
  );
}
