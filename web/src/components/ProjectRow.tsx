import { Button, IconButton, Icon, InlineStatus, StatusBadge, StatusIcon } from '@/ds';
import { connectionCopy } from '@/mocks/connection';
import type { Project } from '@/mocks/types';
import styles from './Entry.module.css';

export interface ProjectRowProps {
  project: Project;
  href: string;
  onMore?: () => void;
  /** Where "Switch to polling" goes on a silent-webhook warning (project settings). */
  switchToPollingHref?: string;
}

export function ProjectRow({ project: p, href, onMore, switchToPollingHref = '#' }: ProjectRowProps) {
  const { tone, mode, text } = p.connection;
  return (
    <tr>
      <td className={styles.projectCell}>
        <a href={href} className={styles.name}>{p.name}</a>
        <span className={styles.repo} title={p.repo}>{p.repo}</span>
      </td>
      <td className={styles.connection}>
        {tone === 'ok' && (
          <span className={styles.okRow}>
            <span title="status: succeeded" className={styles.glyph}><StatusIcon status="succeeded" size={12} title="status: succeeded" /></span>
            {text}
          </span>
        )}
        {tone === 'warn' && (
          <>
            <InlineStatus tone="idle" icon={<Icon name="warning" size={14} />}>{text}</InlineStatus>
            {mode === 'webhook' && (
              <span className={styles.connAction}>
                <Button size="sm" href={switchToPollingHref} aria-label={`${connectionCopy.switchToPolling} for ${p.name}`}>
                  {connectionCopy.switchToPolling}
                </Button>
              </span>
            )}
          </>
        )}
        {tone === 'fail' && (
          <InlineStatus
            tone="fail"
            icon={<span title="status: failed" className={styles.glyph}><StatusIcon status="failed" size={12} title="status: failed" /></span>}
          >
            {text}
          </InlineStatus>
        )}
      </td>
      <td>
        {p.needsYou > 0
          ? <StatusBadge status="idle" variant="pill">{p.needsYou} {p.needsYou === 1 ? 'run' : 'runs'}</StatusBadge>
          : <span className={styles.noneText}>None</span>}
      </td>
      <td className="num">{p.running}</td>
      <td className="num">{p.queued}</td>
      <td className={styles.lastRun}>{p.lastRun}</td>
      <td className={styles.end}>
        <IconButton icon="more" aria-label={`More for ${p.name}`} onClick={onMore} />
      </td>
    </tr>
  );
}
