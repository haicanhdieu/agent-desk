import { IconButton, Icon, InlineStatus, StatusBadge, StatusIcon } from '@/ds';
import type { Project } from '@/mocks/types';
import styles from './Entry.module.css';

export interface ProjectRowProps {
  project: Project;
  href: string;
  onMore?: () => void;
}

export function ProjectRow({ project: p, href, onMore }: ProjectRowProps) {
  const ok = p.connection.tone === 'ok';
  return (
    <tr>
      <td className={styles.projectCell}>
        <a href={href} className={styles.name}>{p.name}</a>
        <span className={styles.repo} title={p.repo}>{p.repo}</span>
      </td>
      <td className={styles.connection}>
        <InlineStatus
          tone={p.connection.tone}
          icon={ok ? <span title="status: succeeded" className={styles.glyph}><StatusIcon status="succeeded" size={12} title="status: succeeded" /></span> : <Icon name="warning" size={14} />}
        >
          {p.connection.text}
        </InlineStatus>
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
