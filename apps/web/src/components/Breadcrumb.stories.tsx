import type { Meta, StoryObj } from '@storybook/react-vite';
import { orgSwitchFixtures } from '@/mocks';
import { Breadcrumb } from './Breadcrumb';
import { OrgSwitch } from './OrgSwitch';
import { ProjectSwitch } from './ProjectSwitch';

const meta = { title: 'Components/Breadcrumb', component: Breadcrumb } satisfies Meta<typeof Breadcrumb>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { items: [{ label: 'invoicer-api', href: '#' }, { label: 'Runs', href: '#' }, { label: 'Run 61' }] },
};
export const LongNames: Story = {
  args: {
    items: [
      { label: 'a-very-long-repository-name-that-keeps-going-and-going-forever', href: '#' },
      { label: 'Runs', href: '#' },
      { label: 'Run 61' },
    ],
  },
};
/** The org and project crumbs are switch buttons ("Org ▾ / Project ▾ / Runs / Run N"). */
export const WithSwitches: Story = {
  args: {
    items: [
      {
        control: (
          <OrgSwitch {...orgSwitchFixtures.oneOrg} orgHref={(o) => `/o/${o.slug}`} createHref="/platform/orgs/new" />
        ),
      },
      { control: <ProjectSwitch project="invoicer-api" /> },
      { label: 'Runs', href: '#' },
      { label: 'Run 61' },
    ],
  },
};
/** A crumb still loading: a fixed-width placeholder named for a screen reader, no text. */
export const LoadingCrumb: Story = {
  args: { items: [{ label: 'Projects', href: '#' }, { loading: 'Loading organization' }] },
};
