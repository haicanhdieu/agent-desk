import type { Meta, StoryObj } from '@storybook/react-vite';
import { AppShell } from '@/components';
import { pagedProjects, projects, user } from '@/mocks';
import { SignIn as SignInScreen } from './SignIn';
import { ProjectsEmpty as ProjectsEmptyScreen } from './ProjectsEmpty';
import { Projects as ProjectsScreen } from './Projects';
import { viewport } from './viewports';

const meta = {
  title: 'Screens/Entry',
  parameters: { layout: 'fullscreen' },
  globals: viewport(1440, 900),
  decorators: [
    (S) => (
      <AppShell height={900} topBar={null}>
        <S />
      </AppShell>
    ),
  ],
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

/** Page 2 of 2 of 26 projects: "Showing 21–26 of 26". */
export const ProjectsPaged: Story = {
  name: 'Projects, page 2 of 2',
  render: () => (
    <ProjectsScreen
      user={user}
      projects={pagedProjects(26).slice(20)}
      newHref="#"
      pagination={{
        page: 2,
        pageSize: 20,
        total: 26,
        onPageChange: () => undefined,
        onPageSizeChange: () => undefined,
      }}
    />
  ),
};
