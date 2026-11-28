import type { Meta, StoryObj } from '@storybook/react-vite';
import { SKILL_TEMPLATES } from '@/features/setup/templates';
import { SkillTemplatePreview } from './SkillTemplatePreview';

const first = SKILL_TEMPLATES[0];
if (!first) throw new Error('no skill templates');

const meta = {
  title: 'Components/SkillTemplatePreview',
  component: SkillTemplatePreview,
  args: { name: first.name, body: first.body, onClose: () => {} },
} satisfies Meta<typeof SkillTemplatePreview>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Loading: Story = { args: { load: () => new Promise(() => {}) } };
export const LoadError: Story = { args: { load: () => Promise.reject(new globalThis.Error('chunk failed')) } };
