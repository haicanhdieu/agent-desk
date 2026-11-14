import type { Meta, StoryObj } from '@storybook/react-vite';
import { Button, CountBadge, IconButton, StatusBadge } from '@/ds';
import { TopBar } from './TopBar';

const user = { login: 'kim-hale', initials: 'KH' };
const project = { org: 'harbor-labs', name: 'invoicer-api', repoUrl: 'https://github.com/harbor-labs/invoicer-api' };

const meta = { title: 'Components/TopBar', component: TopBar, parameters: { layout: 'fullscreen' } } satisfies Meta<
  typeof TopBar
>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Global: Story = { args: { variant: 'global', user } };
export const ProjectNeedsYou: Story = { args: { variant: 'project', user, project, active: 'runs', needsYou: 1 } };
export const ProjectDesk: Story = { args: { variant: 'project', user, project, active: 'desk' } };
export const LongProjectName: Story = {
  args: {
    variant: 'project',
    user,
    project: { ...project, name: 'a-very-long-repository-name-that-keeps-going-and-going-and-going-forever' },
    active: 'runs',
    needsYou: 2,
  },
};
export const Run: Story = {
  args: {
    variant: 'run',
    user,
    breadcrumb: [
      { label: 'invoicer-api', href: '#' },
      {
        label: (
          <>
            Runs <CountBadge count={1} />
          </>
        ),
        href: '#',
      },
      { label: 'Run 61' },
    ],
    children: (
      <>
        <StatusBadge status="running" />
        <span>
          <code>/code-build</code> on Issue #139
        </span>
        <span className="num muted">7:40</span>
      </>
    ),
    actions: (
      <>
        <Button disabled icon="check">
          Finish
        </Button>
        <Button variant="danger" icon="x">
          Cancel run
        </Button>
        <span style={{ width: 1, height: 22, background: 'var(--line2)' }} />
        <IconButton icon="panel" aria-label="Toggle side panel" />
        <IconButton icon="fullscreen" aria-label="Full screen" />
      </>
    ),
  },
};
export const RunLongNames: Story = {
  args: {
    variant: 'run',
    user,
    breadcrumb: [
      { label: 'a-very-long-repository-name-that-keeps-going-and-going-forever', href: '#' },
      { label: 'Runs', href: '#' },
      { label: 'Run 61' },
    ],
    children: (
      <span>
        /code-build on Issue #139: an extremely long ticket title that should truncate rather than wrap or push the
        actions
      </span>
    ),
    actions: (
      <Button variant="danger" icon="x">
        Cancel run
      </Button>
    ),
  },
};
