import type { Meta, StoryObj } from '@storybook/react-vite';
import { GuardsCard } from './GuardsCard';

const meta = {
  title: 'Components/GuardsCard',
  component: GuardsCard,
  decorators: [
    (S) => (
      <div style={{ width: 320 }}>
        <S />
      </div>
    ),
  ],
} satisfies Meta<typeof GuardsCard>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { args: { maxRunsPerTicket: 10, changeHref: '#', ignoredHref: '#' } };
export const NoLinks: Story = { args: { maxRunsPerTicket: 5 } };
