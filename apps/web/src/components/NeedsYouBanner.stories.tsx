import type { Meta, StoryObj } from '@storybook/react-vite';
import { runs } from '@/mocks';
import { NeedsYouBanner } from './NeedsYouBanner';

const meta = {
  title: 'Components/NeedsYouBanner',
  component: NeedsYouBanner,
  decorators: [
    (S) => (
      <div style={{ width: 1100 }}>
        <S />
      </div>
    ),
  ],
} satisfies Meta<typeof NeedsYouBanner>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    run: runs.find((r) => r.id === 62)!,
    askedAgo: '3 minutes ago',
    href: '#',
    slotNote:
      'It holds one of your 2 slots, so Run 63 is waiting. It ends on its own after 10 minutes with nobody attached.',
  },
};
