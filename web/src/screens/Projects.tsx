import { Button } from '@/ds';
import { DataTable, ProjectRow, TopBar } from '@/components';
import type { Actor, Project } from '@/mocks/types';
import { ProjectsEmpty } from './ProjectsEmpty';
import styles from './Screens.module.css';

export interface ProjectsProps {
  user: Actor;
  projects: Project[];
  newHref: string;
}

const columns = [
  { key: 'project', header: 'Project' },
  { key: 'github', header: 'GitHub' },
  { key: 'needs', header: 'Needs you' },
  { key: 'running', header: 'Running' },
  { key: 'queued', header: 'Queued' },
  { key: 'last', header: 'Last run' },
  { key: 'more', header: <span className={styles.srOnly}>Actions</span> },
];

export function Projects({ user, projects, newHref }: ProjectsProps) {
  if (projects.length === 0) return <ProjectsEmpty user={user} createHref={newHref} />;
  return (
    <>
      <TopBar variant="global" user={user} />
      <main className={styles.listMain}>
        <div className={styles.listHead}>
          <h1>Projects</h1>
          <Button variant="primary" icon="plus" href={newHref}>New project</Button>
        </div>
        <p className={`muted ${styles.listIntro}`}>
          After sign-in you land on the runs of the project you used last. This list is one click away on the logo.
        </p>
        <DataTable columns={columns}>
          {projects.map((p) => <ProjectRow key={p.id} project={p} href="/runs" />)}
        </DataTable>
      </main>
    </>
  );
}
