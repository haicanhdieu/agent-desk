import type { ReactNode } from 'react';
import { DeskLayout, TopBar } from '@/components';
import { Banner, Button, Icon } from '@/ds';
import type { Actor, ConnectionStatus } from '@/mocks/types';
import styles from './Screens.module.css';

/** In-app hrefs of the top bar and Desk navigation. */
export interface DeskLinks {
  projects: string;
  runs: string;
  desk: string;
  skills: string;
  rules: string;
  agent: string;
  /** Desk Setup tab; the nav item is hidden without it. */
  setup?: string;
}

/** A warning above the Desk boards (workspace setup, spec §5.5). It never blocks anything. */
export interface FrameWarning {
  title: string;
  detail: string;
  /** Where the details are (the Desk Setup tab). */
  href?: string;
}

/** What the frame shows around every Desk board: the user, the project and its connection, and the nav links. */
export interface DeskFrameData {
  user: Actor;
  /** `org` is the repository owner; `repo` is "owner/name". */
  project: { org: string; name: string; repo: string; needsYou: number };
  connection: ConnectionStatus;
  /** Defaults to the relative hrefs of the prototype ("/runs", "skills", …). */
  links?: DeskLinks;
  /** Shown above every board but the Setup tab, which has its own last-test banner. */
  warning?: FrameWarning;
}

/** Top bar plus the Desk sub navigation shared by the Desk boards. Children render in the content column. */
export function DeskFrame({
  active,
  user,
  project,
  connection,
  links,
  warning,
  children,
}: DeskFrameData & { active: 'skills' | 'rules' | 'agent' | 'setup'; children?: ReactNode }) {
  return (
    <>
      <TopBar
        variant="project"
        active="desk"
        user={user}
        needsYou={project.needsYou}
        project={{ org: project.org, name: project.name, repoUrl: `https://github.com/${project.repo}` }}
        links={links}
      />
      <DeskLayout
        active={active}
        repo={{
          org: project.org,
          name: project.name,
          branch: 'main',
          connected: connection.tone !== 'err',
          status: connection,
        }}
        links={links}
      >
        {warning && active !== 'setup' && (
          <div className={styles.deskWarning}>
            <Banner
              tone="warn"
              icon={<Icon name="warning" size={16} />}
              title={warning.title}
              centered
              actions={
                warning.href ? (
                  <Button size="sm" href={warning.href}>
                    Open workspace setup
                  </Button>
                ) : undefined
              }
            >
              {warning.detail}
            </Banner>
          </div>
        )}
        {children}
      </DeskLayout>
    </>
  );
}
