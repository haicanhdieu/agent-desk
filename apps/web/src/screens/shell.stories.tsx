import type { Meta, StoryObj } from '@storybook/react-vite';
import { orgSwitchFixtures, runDetails, terminalByRun } from '@/mocks';
import { RunDetail } from './RunDetail';
import { viewport } from './viewports';

// The shared app shell on the run page: org / project / Runs / Run N with the bell and no tabs.
const meta = {
  title: 'Screens/Shell',
  component: RunDetail,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof RunDetail>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Board RunIdleShell: the run bar over the idle run 62. */
export const RunIdleShell: Story = {
  decorators: [
    (S) => (
      <div style={{ width: 1440, height: 900 }}>
        <S />
      </div>
    ),
  ],
  globals: viewport(1440, 900),
  args: {
    data: runDetails.RunIdle,
    lines: terminalByRun[62],
    org: { ...orgSwitchFixtures.severalOrgsSettings, orgHref: (o) => `#${o.slug}`, createHref: '#new-org' },
    run: { runsHref: '#runs', label: 'Run 62' },
  },
};
