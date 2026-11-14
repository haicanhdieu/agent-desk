import type { Meta, StoryObj } from '@storybook/react-vite';
import { SkillTemplateCard } from './SkillTemplateCard';

const meta = {
  title: 'Components/SkillTemplateCard',
  component: SkillTemplateCard,
  args: {
    template: {
      name: 'code-build',
      note: 'chains to code-review',
      description: 'Implement an issue on a branch, run build and tests, open a PR, then comment /code-review on it.',
    },
    checked: true,
    onChange: () => {},
    previewHref: '#',
  },
  decorators: [
    (S) => (
      <div style={{ width: 720 }}>
        <S />
      </div>
    ),
  ],
} satisfies Meta<typeof SkillTemplateCard>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Selected: Story = {};
export const Unselected: Story = { args: { checked: false } };
export const NoNote: Story = {
  args: {
    template: {
      name: 'code-review',
      description: 'Review a PR, fix small problems, run tests, then approve or request changes.',
    },
  },
};
