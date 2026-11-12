import type { ReactNode } from 'react';
import { Icon, InlineStatus, StatusIcon } from '@/ds';
import { SubNav } from './SubNav';
import styles from './Chrome.module.css';

export interface DeskLayoutProps {
  active: 'skills' | 'rules' | 'agent';
  repo: {
    org: string;
    name: string;
    branch: string;
    connected: boolean;
    /** Connection status line. Defaults to "Connected" when `connected` is set. */
    status?: { tone: 'ok' | 'warn' | 'fail'; text: string };
  };
  children?: ReactNode;
}

export function DeskLayout({ active, repo, children }: DeskLayoutProps) {
  const status = repo.status ?? (repo.connected ? { tone: 'ok' as const, text: 'Connected' } : undefined);
  return (
    <div className={styles.body}>
      <SubNav
        aria-label="Desk"
        groups={[
          {
            heading: 'Desk',
            items: [
              { label: 'Skills', href: 'skills', icon: 'skill-file', active: active === 'skills' },
              { label: 'Routing rules', href: 'rules', icon: 'rule', active: active === 'rules' },
              { label: 'Agent & settings', href: 'agent', icon: 'bot', active: active === 'agent' },
            ],
          },
          {
            heading: 'Repository',
            content: (
              <>
                <span className={styles.repoName}>
                  <span className={styles.repoOrg}>{repo.org} /</span>
                  {repo.name}
                </span>
                <span className={styles.repoLine}>
                  <Icon name="branch" size={13} />
                  <span className="mono">{repo.branch}</span>
                </span>
                {status?.tone === 'ok' && <span className={styles.connected}><StatusIcon status="succeeded" size={12} /><span className="muted">{status.text}</span></span>}
                {status && status.tone !== 'ok' && (
                  <InlineStatus tone={status.tone === 'fail' ? 'fail' : 'idle'} icon={<Icon name="warning" size={12} />}>{status.text}</InlineStatus>
                )}
              </>
            ),
          },
        ]}
      />
      <div className={styles.main}>{children}</div>
    </div>
  );
}
