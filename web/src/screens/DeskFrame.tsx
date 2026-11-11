import type { ReactNode } from 'react';
import { DeskLayout, TopBar } from '@/components';
import { projects, user } from '@/mocks';

const project = projects[0];

/** Top bar plus the Desk sub navigation shared by the three Desk boards. Children render in the content column. */
export function DeskFrame({ active, children }: { active: 'skills' | 'rules' | 'agent'; children?: ReactNode }) {
  return (
    <>
      <TopBar
        variant="project"
        active="desk"
        user={user}
        needsYou={project.needsYou}
        project={{ org: project.org, name: project.name, repoUrl: `https://github.com/${project.repo}` }}
      />
      <DeskLayout active={active} repo={{ org: project.org, name: project.name, branch: 'main', connected: true }}>
        {children}
      </DeskLayout>
    </>
  );
}
