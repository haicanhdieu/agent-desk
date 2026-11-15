import type { Meta, StoryObj } from '@storybook/react-vite';
import { runDetails } from '@/mocks';
import { RunPromptSection } from './RunPromptSection';
import { SidePanel } from './SidePanel';

const meta = {
  title: 'Components/RunPromptSection',
  component: RunPromptSection,
  decorators: [
    (S) => (
      <div style={{ height: 420, display: 'flex' }}>
        <SidePanel>
          <S />
        </SidePanel>
      </div>
    ),
  ],
} satisfies Meta<typeof RunPromptSection>;
export default meta;
type Story = StoryObj<typeof meta>;

const prompt = runDetails.RunSucceeded.finalPrompt ?? '';

export const Collapsed: Story = { args: { finalPrompt: prompt } };
export const Expanded: Story = { args: { finalPrompt: prompt, defaultOpen: true } };
/** A run started before prompts were recorded. */
export const NotRecorded: Story = { args: { finalPrompt: null } };
