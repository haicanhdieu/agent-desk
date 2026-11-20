import type { Meta, StoryObj } from '@storybook/react-vite';
import { skillPreviewSamples } from '../mocks';
import { SkillPreviewPane } from './SkillPreviewPane';

const meta = {
  title: 'Components/SkillPreviewPane',
  component: SkillPreviewPane,
  decorators: [
    (Story) => (
      <div style={{ display: 'flex', flexDirection: 'column', height: 480 }}>
        <Story />
      </div>
    ),
  ],
  args: { value: skillPreviewSamples.table },
} satisfies Meta<typeof SkillPreviewPane>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Loading: Story = { args: { load: () => new Promise(() => {}) } };
export const Error: Story = { args: { load: () => Promise.reject(new globalThis.Error('chunk failed')) } };
