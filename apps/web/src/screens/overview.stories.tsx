import type { Meta, StoryObj } from '@storybook/react-vite';
import { Overview } from './Overview';
import { viewport } from './viewports';

// Artboard from canvas.json: Main is 1440x900. The wrapper fixes the size.
const meta = {
  title: 'Screens/Overview',
  component: Overview,
  parameters: { layout: 'fullscreen' },
  globals: viewport(1440, 900),
  decorators: [
    (S) => (
      <div style={{ width: 1440, height: 900 }}>
        <S />
      </div>
    ),
  ],
} satisfies Meta<typeof Overview>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Main: Story = { name: 'Index' };
