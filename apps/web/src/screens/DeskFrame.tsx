import type { ReactNode } from 'react';
import { DeskLayout, TopBar } from '@/components';
import { projects, user } from '@/mocks';
import type { ConnectionStatus } from '@/mocks/types';

const project = projects[0];

/** Top bar plus the Desk sub navigation shared by the three Desk boards. Children render in the content column. */
export function DeskFrame({ active, connection = project.connection, children }: { active: 'skills' | 'rules' | 'agent'; connection?: ConnectionStatus; children?: ReactNode }) {
  return (
    <>
      <TopBar
        variant="project"
        active="desk"
        user={user}
        needsYou={project.needsYou}
        project={{ org: project.org, name: project.name, repoUrl: `https://github.com/${project.repo}` }}
      />
      <DeskLayout active={active} repo={{ org: project.org, name: project.name, branch: 'main', connected: connection.tone !== 'err', status: connection }}>
        {children}
      </DeskLayout>
    </>
  );
}
