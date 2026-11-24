import type { Meta, StoryObj } from '@storybook/react-vite';
import { within } from 'storybook/test';
import { SkipLink } from './SkipLink';

const meta = { title: 'Components/SkipLink', component: SkipLink } satisfies Meta<typeof SkipLink>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Hidden off-screen until it gets keyboard focus. */
export const Default: Story = {};
/** Focused: the pill shows at the top left. */
export const Focused: Story = {
  play: async ({ canvasElement }) => {
    within(canvasElement).getByRole('link', { name: 'Skip to main content' }).focus();
  },
};
