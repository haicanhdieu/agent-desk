import { Icon, InlineStatus, StatusIcon } from '@/ds';
import styles from './Chrome.module.css';

export interface RepoBlockProps {
  owner: string;
  name: string;
  branch: string | null;
  status?: { tone: 'ok' | 'warn' | 'err'; text: string };
  repoUrl: string;
}

export function RepoBlock({ owner, name, branch, status, repoUrl }: RepoBlockProps) {
  return (
    <section className={styles.repoBlock} aria-labelledby="repo-block-heading">
      <div className={styles.grpH} id="repo-block-heading">
        Repository
      </div>
      <div className={styles.grpBody}>
        <span className={styles.repoName}>
          <span className={styles.repoOrg}>{owner} /</span>
          {name}
        </span>
        {branch && (
          <span className={styles.repoLine}>
            <Icon name="branch" size={13} />
            <span className="mono">{branch}</span>
          </span>
        )}
        {status?.tone === 'ok' && (
          <span className={styles.connected}>
            <StatusIcon status="succeeded" size={12} />
            <span className="muted">{status.text}</span>
          </span>
        )}
        {status && status.tone !== 'ok' && (
          <InlineStatus tone={status.tone === 'err' ? 'err' : 'idle'} icon={<Icon name="warning" size={12} />}>
            {status.text}
          </InlineStatus>
        )}
        <a href={repoUrl} target="_blank" rel="noopener noreferrer" className={styles.repoLine}>
          <Icon name="external" size={12} />
          Open repository
        </a>
      </div>
    </section>
  );
}
