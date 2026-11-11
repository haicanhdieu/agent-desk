import type { ReactNode } from 'react';
import { Icon, StatusIcon } from '@/ds';
import { SubNav } from './SubNav';
import styles from './Chrome.module.css';

export interface DeskLayoutProps {
  active: 'skills' | 'rules' | 'agent';
  repo: { org: string; name: string; branch: string; connected: boolean };
  children?: ReactNode;
}

export function DeskLayout({ active, repo, children }: DeskLayoutProps) {
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
                {repo.connected && <span className={styles.connected}><StatusIcon status="succeeded" size={12} /><span className="muted">Connected</span></span>}
              </>
            ),
          },
        ]}
      />
      <div className={styles.main}>{children}</div>
    </div>
  );
}
