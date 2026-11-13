import type { ReactNode } from 'react';
import { DeskLayout, TopBar } from '@/components';
import type { Actor, ConnectionStatus } from '@/mocks/types';

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

/** What the frame shows around every Desk board: the user, the project and its connection, and the nav links. */
export interface DeskFrameData {
  user: Actor;
  /** `org` is the repository owner; `repo` is "owner/name". */
  project: { org: string; name: string; repo: string; needsYou: number };
  connection: ConnectionStatus;
  /** Defaults to the relative hrefs of the prototype ("/runs", "skills", …). */
  links?: DeskLinks;
}

/** Top bar plus the Desk sub navigation shared by the Desk boards. Children render in the content column. */
export function DeskFrame({
  active,
  user,
  project,
  connection,
  links,
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
        {children}
      </DeskLayout>
    </>
  );
}
