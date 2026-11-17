import type { Meta, StoryObj } from '@storybook/react-vite';
import { runs } from '@/mocks';
import { NeedsYouBanner } from './NeedsYouBanner';

const run62 = runs.find((r) => r.id === 62);
if (!run62) throw new Error('mock run 62 is missing');

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
    run: run62,
    askedAgo: '3 minutes ago',
    href: '#',
    slotNote:
      'It holds one of your 2 slots, so Run 63 is waiting. It ends on its own after 30 minutes with nobody attached.',
  },
};

/** No valid ticket URL: the ticket number is plain text, not a link. */
export const NoTicketLink: Story = {
  args: {
    ...Default.args,
    run: { ...run62, ticket: { ...run62.ticket, href: '' } },
  },
};
