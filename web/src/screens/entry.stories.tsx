import type { Meta, StoryObj } from '@storybook/react-vite';
import { AppShell } from '@/components';
import { projects, user } from '@/mocks';
import { SignIn as SignInScreen } from './SignIn';
import { ProjectsEmpty as ProjectsEmptyScreen } from './ProjectsEmpty';
import { Projects as ProjectsScreen } from './Projects';

const meta = {
  title: 'Screens/Entry',
  parameters: { layout: 'fullscreen', viewport: { defaultViewport: 'desktop1440' } },
  decorators: [(S) => <AppShell height={900} topBar={null}><S /></AppShell>],
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const SignIn: Story = {
  name: 'Sign in',
  render: () => <SignInScreen signInHref="#" />,
};
export const ProjectsEmpty: Story = {
  name: 'Projects, empty',
  render: () => <ProjectsEmptyScreen user={user} createHref="#" />,
};
export const Projects: Story = {
  name: 'Projects',
  render: () => <ProjectsScreen user={user} projects={projects} newHref="#" />,
};
