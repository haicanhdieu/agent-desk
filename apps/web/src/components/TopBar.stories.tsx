import type { Meta, StoryObj } from '@storybook/react-vite';
import { Button, IconButton, StatusBadge } from '@/ds';
import { orgSwitchFixtures } from '@/mocks';
import { TopBar } from './TopBar';

const user = { login: 'kim-hale', initials: 'KH' };
const project = { name: 'invoicer-api', repoUrl: 'https://github.com/harbor-labs/invoicer-api' };

const meta = { title: 'Components/TopBar', component: TopBar, parameters: { layout: 'fullscreen' } } satisfies Meta<
  typeof TopBar
>;
export default meta;
type Story = StoryObj<typeof meta>;

const orgBase = {
  orgHref: (o: { slug: string }) => `/o/${o.slug}`,
  createHref: '/orgs/new',
  projectsHref: '#projects',
};
const orgWithSettings = { ...orgBase, ...orgSwitchFixtures.oneOrg, settingsHref: '#settings' };
const orgNoSettings = { ...orgBase, ...orgSwitchFixtures.oneOrg };
const links = { projects: '#projects', runs: '#runs', desk: '#desk' };

export const OrgLevelOwner: Story = {
  args: { variant: 'global', user, org: orgWithSettings, tabs: 'org', active: 'projects', links },
};
export const OrgLevelMember: Story = {
  args: { variant: 'global', user, org: orgNoSettings, tabs: 'org', active: 'projects', links },
};
export const OrgLevelSettingsActive: Story = {
  args: { variant: 'global', user, org: orgWithSettings, tabs: 'org', active: 'settings', links },
};
export const PersonalNoTabActive: Story = {
  args: { variant: 'global', user, org: orgWithSettings, tabs: 'org', links },
};
export const CreateOrgNoTabs: Story = {
  args: { variant: 'global', user, org: { ...orgBase, ...orgSwitchFixtures.platformAdmin }, tabs: 'none' },
};
export const NoOrg: Story = {
  args: { variant: 'global', user, org: { ...orgBase, current: null, orgs: [], platformAdmin: false } },
};
export const ProjectLevel: Story = {
  args: { variant: 'project', user, org: orgWithSettings, project, active: 'runs', needsYou: 1, links },
};
export const ProjectLevelDesk: Story = {
  args: { variant: 'project', user, org: orgWithSettings, project, active: 'desk', links },
};
export const LongOrgName: Story = {
  args: {
    variant: 'global',
    user,
    org: { ...orgBase, ...orgSwitchFixtures.longName, settingsHref: '#settings' },
    tabs: 'org',
    active: 'projects',
    links,
  },
};
export const RunLevel: Story = {
  args: {
    variant: 'run',
    user,
    org: orgWithSettings,
    project,
    run: { runsHref: '#runs', label: 'Run 61' },
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
