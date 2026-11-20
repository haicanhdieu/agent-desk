import type { Meta, StoryObj } from '@storybook/react-vite';
import { skillPreviewSamples, skills } from '../mocks';
import { SkillPreview } from './SkillPreview';

const body = skills.find((s) => s.name === 'code-build')?.body ?? '';

const meta = {
  title: 'Components/SkillPreview',
  component: SkillPreview,
  decorators: [
    (Story) => (
      <div style={{ display: 'flex', flexDirection: 'column', height: 480 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof SkillPreview>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { args: { value: body } };
export const WithTable: Story = { args: { value: skillPreviewSamples.table } };
export const Empty: Story = { args: { value: '' } };
export const WithDiagram: Story = { args: { value: skillPreviewSamples.diagram } };
export const DiagramLoading: Story = {
  args: { value: skillPreviewSamples.diagram, loadMermaid: () => new Promise(() => {}) },
};
export const DiagramError: Story = { args: { value: skillPreviewSamples.brokenDiagram } };
